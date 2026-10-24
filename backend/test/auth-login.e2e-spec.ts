import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { LoginRateLimitService } from './../src/app/modules/auth/login-rate-limit.service.js';

// Menguji lapisan HTTP: rate limit login, validasi DTO admin, dan kontrak login
// yang dipakai frontend. Tidak mengubah data dan tidak memerlukan DB.
describe('Auth & validasi admin (e2e)', () => {
  let app: INestApplication<App>;
  let limiter: LoginRateLimitService;
  let adminToken: string;

  const ADMIN_EMAIL = 'admin@jawara-billing.com';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    limiter = app.get(LoginRateLimitService);
  });

  beforeEach(() => {
    limiter.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email, password });

  describe('login', () => {
    it('menolak password salah dengan 401 dan pesan generik', async () => {
      const res = await login(ADMIN_EMAIL, 'password-salah').expect(401);
      expect(res.body.message).toBe('Email atau password salah');
    });

    it('memberi pesan sama untuk email yang tidak terdaftar (tanpa enumeration)', async () => {
      const res = await login('tidak-ada@jawara-billing.com', 'apa-saja-123').expect(401);
      expect(res.body.message).toBe('Email atau password salah');
    });

    it('mengembalikan token dengan masa berlaku 8 jam', async () => {
      const res = await login(ADMIN_EMAIL, 'password123').expect(200);
      const payload = new JwtService().decode(res.body.token) as { exp: number; iat: number };

      expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
      adminToken = res.body.token;
    });

    it('tidak mengirim password_hash pada respons login', async () => {
      const res = await login(ADMIN_EMAIL, 'password123').expect(200);
      expect(res.body.user).not.toHaveProperty('password_hash');
    });
  });

  describe('rate limit login', () => {
    it('memberi 429 setelah 5 percobaan gagal', async () => {
      for (let i = 0; i < 5; i += 1) {
        await login(ADMIN_EMAIL, 'password-salah').expect(401);
      }
      const res = await login(ADMIN_EMAIL, 'password-salah').expect(429);

      expect(res.body.statusCode).toBe(429);
      expect(res.body.message).toContain('Terlalu banyak percobaan login');
    });

    it('tidak bisa dilewati dengan variasi kapitalisasi atau spasi email', async () => {
      for (let i = 0; i < 5; i += 1) {
        await login(ADMIN_EMAIL, 'password-salah').expect(401);
      }

      await login('  ADMIN@Jawara-Billing.com  ', 'password-salah').expect(429);
      await login('Admin@jawara-billing.COM', 'password-salah').expect(429);
    });

    it('login berhasil mereset kuota', async () => {
      for (let i = 0; i < 4; i += 1) {
        await login(ADMIN_EMAIL, 'password-salah').expect(401);
      }
      await login(ADMIN_EMAIL, 'password123').expect(200);
      await login(ADMIN_EMAIL, 'password-salah').expect(401);
    });
  });

  describe('validasi DTO admin', () => {
    beforeAll(async () => {
      const res = await login(ADMIN_EMAIL, 'password123').expect(200);
      adminToken = res.body.token;
    });

    it('menolak role tidak valid dengan 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Role Asing',
          email: 'role.asing@example.test',
          password: 'rahasia-uji-123',
          role: 'superadmin',
        })
        .expect(400);
    });

    it('menolak password terlalu pendek dengan 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Password Pendek',
          email: 'pendek@example.test',
          password: 'pendek',
          role: 'operator',
        })
        .expect(400);
    });

    it('menolak field di luar kontrak DTO dengan 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Field Asing',
          email: 'asing@example.test',
          password: 'rahasia-uji-123',
          role: 'operator',
          is_superuser: true,
        })
        .expect(400);
    });

    it('menerima payload sah dan tidak membocorkan hash', async () => {
      limiter.reset();
      const res = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Operator Sah',
          email: 'operator.sah@example.test',
          password: 'rahasia-uji-123',
          role: 'operator',
        })
        .expect(201);

      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body.role).toBe('operator');
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { LoginRateLimitService } from './../src/app/modules/auth/login-rate-limit.service.js';
import { createFakeUsers, FakeUsers, TEST_PASSWORD } from './helpers/fake-users.js';

// Lapisan HTTP login: kontrak respons, rate limit, dan validasi DTO admin.
// UsersRepository diganti versi in-memory → tidak menyentuh tabel users nyata.
describe('Auth & validasi admin (e2e)', () => {
  let app: INestApplication<App>;
  let fake: FakeUsers;
  let limiter: LoginRateLimitService;
  let adminToken: string;

  const ADMIN_EMAIL = 'admin@uji.test';

  beforeAll(async () => {
    fake = await createFakeUsers();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fake.repo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    limiter = app.get(LoginRateLimitService);

    const admin = fake.accounts.get(1)!;
    adminToken = new JwtService().sign(
      { sub: admin.id, email: admin.email, role: admin.role },
      { secret: app.get(ConfigService).jwtSecret, expiresIn: '1h' },
    );
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
      const res = await login('tidak-ada@uji.test', 'apa-saja-123').expect(401);
      expect(res.body.message).toBe('Email atau password salah');
    });

    it('mengembalikan token dengan masa berlaku 8 jam', async () => {
      const res = await login(ADMIN_EMAIL, TEST_PASSWORD).expect(200);
      const payload = new JwtService().decode(res.body.token) as { exp: number; iat: number };

      expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
    });

    it('tidak mengirim password_hash pada respons login', async () => {
      const res = await login(ADMIN_EMAIL, TEST_PASSWORD).expect(200);
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('menolak login akun nonaktif dengan pesan yang sama', async () => {
      const current = fake.accounts.get(2)!;
      fake.accounts.set(2, { ...current, is_active: false });

      const res = await login('operator@uji.test', TEST_PASSWORD).expect(401);
      expect(res.body.message).toBe('Email atau password salah');

      fake.accounts.set(2, current);
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

      await login('  ADMIN@Uji.Test  ', 'password-salah').expect(429);
      await login('Admin@uji.TEST', 'password-salah').expect(429);
    });

    it('login berhasil mereset kuota', async () => {
      for (let i = 0; i < 4; i += 1) {
        await login(ADMIN_EMAIL, 'password-salah').expect(401);
      }
      await login(ADMIN_EMAIL, TEST_PASSWORD).expect(200);
      await login(ADMIN_EMAIL, 'password-salah').expect(401);
    });
  });

  describe('validasi DTO admin', () => {
    it('menolak role tidak valid dengan 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Role Asing',
          email: 'role.asing@uji.test',
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
          email: 'pendek@uji.test',
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
          email: 'asing@uji.test',
          password: 'rahasia-uji-123',
          role: 'operator',
          is_superuser: true,
        })
        .expect(400);
    });

    it('menerima payload sah, menyimpan bcrypt, dan tidak membocorkan hash', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Operator Sah',
          email: 'operator.sah@uji.test',
          password: 'rahasia-uji-123',
          role: 'operator',
        })
        .expect(201);

      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body.role).toBe('operator');

      const stored = [...fake.accounts.values()].find((u) => u.email === 'operator.sah@uji.test');
      expect(stored?.password_hash).toMatch(/^\$2[aby]\$12\$/);
    });

    it('user yang dibuat lewat endpoint admin dapat login', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bisa Login',
          email: 'bisalogin@uji.test',
          password: 'rahasia-uji-123',
          role: 'operator',
        })
        .expect(201);

      limiter.reset();
      await login('bisalogin@uji.test', 'rahasia-uji-123').expect(200);
    });

    it('menolak email duplikat dengan 409', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplikat',
          email: ADMIN_EMAIL,
          password: 'rahasia-uji-123',
          role: 'operator',
        })
        .expect(409);
    });
  });
});

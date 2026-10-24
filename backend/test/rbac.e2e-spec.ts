import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';

// Token per role ditandatangani dengan secret aplikasi yang sama seperti
// AuthService, karena auth masih in-memory (belum ada user operator/resseler
// nyata untuk login). Ini menguji lapisan otorisasi, bukan lapisan kredensial.
describe('RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let secret: string;
  let realAdminToken: string;

  const tokens: Record<string, string> = {};

  const sign = (role: string) =>
    jwt.sign({ sub: 1, email: `${role}@test.local`, role }, { secret, expiresIn: '1h' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    jwt = new JwtService();
    secret = app.get(ConfigService).jwtSecret;

    tokens.admin = sign('admin');
    tokens.operator = sign('operator');
    tokens.resseler = sign('resseler');
    tokens.unknown = sign('superadmin');

    // Token admin asli (user seed in-memory) untuk menguji endpoint profil,
    // yang membutuhkan email pengguna yang benar-benar ada.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@jawara-billing.com', password: 'password123' })
      .expect(200);
    realAdminToken = login.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('/api/admin/users — hanya admin', () => {
    it('menolak tanpa token dengan 401', async () => {
      await call('get', '/api/admin/users').expect(401);
    });

    it('menolak operator dengan 403', async () => {
      await call('get', '/api/admin/users', tokens.operator).expect(403);
    });

    it('menolak reseller dengan 403', async () => {
      await call('get', '/api/admin/users', tokens.resseler).expect(403);
    });

    it('menolak role tidak dikenal dengan 403', async () => {
      await call('get', '/api/admin/users', tokens.unknown).expect(403);
    });

    it('mengizinkan admin', async () => {
      const res = await call('get', '/api/admin/users', tokens.admin).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('operator tidak bisa menaikkan role sendiri lewat PATCH', async () => {
      await call('patch', '/api/admin/users/1', tokens.operator)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('operator tidak bisa membuat akun admin baru', async () => {
      await call('post', '/api/admin/users', tokens.operator)
        .send({ name: 'X', email: 'x@test.local', password: 'rahasia123', role: 'admin' })
        .expect(403);
    });

    it('operator tidak bisa menghapus akun', async () => {
      await call('delete', '/api/admin/users/1', tokens.operator).expect(403);
    });
  });

  describe('/api/customers', () => {
    it('tanpa token → 401', async () => {
      await call('get', '/api/customers').expect(401);
    });

    it('admin → 200', async () => {
      await call('get', '/api/customers', tokens.admin).expect(200);
    });

    it('operator → 200', async () => {
      await call('get', '/api/customers', tokens.operator).expect(200);
    });

    it('reseller → 403 (belum ada relasi kepemilikan)', async () => {
      await call('get', '/api/customers', tokens.resseler).expect(403);
    });

    it('operator tidak boleh menghapus pelanggan', async () => {
      await call('delete', '/api/customers/999999', tokens.operator).expect(403);
    });

    it('reseller tidak boleh menambah pelanggan', async () => {
      await call('post', '/api/customers', tokens.resseler)
        .send({ name: 'Y', email: 'y@test.local', phone: '081234567' })
        .expect(403);
    });
  });

  describe('/api/packages', () => {
    it('operator boleh membaca katalog', async () => {
      await call('get', '/api/packages', tokens.operator).expect(200);
    });

    it('reseller boleh membaca katalog', async () => {
      await call('get', '/api/packages', tokens.resseler).expect(200);
    });

    it('operator tidak boleh menambah paket', async () => {
      await call('post', '/api/packages', tokens.operator)
        .send({ name: 'P', description: 'd', price: 1000, data_limit: '1GB', speed: 10, valid_days: 30 })
        .expect(403);
    });

    it('reseller tidak boleh mengubah paket', async () => {
      await call('patch', '/api/packages/1', tokens.resseler).send({ price: 1 }).expect(403);
    });
  });

  describe('/api/invoices', () => {
    it('operator boleh membaca tagihan', async () => {
      await call('get', '/api/invoices', tokens.operator).expect(200);
    });

    it('reseller ditolak 403', async () => {
      await call('get', '/api/invoices', tokens.resseler).expect(403);
    });

    it('operator tidak boleh menghapus tagihan', async () => {
      await call('delete', '/api/invoices/999999', tokens.operator).expect(403);
    });

    it('GET /invoices/summary tidak tertangkap route :id', async () => {
      const res = await call('get', '/api/invoices/summary', tokens.admin).expect(200);
      expect(res.body).toHaveProperty('total');
    });
  });

  describe('/api/dashboard', () => {
    it('tanpa token → 401', async () => {
      await call('get', '/api/dashboard').expect(401);
    });

    it('admin → 200', async () => {
      await call('get', '/api/dashboard', tokens.admin).expect(200);
    });

    it('operator → 200', async () => {
      await call('get', '/api/dashboard', tokens.operator).expect(200);
    });

    it('reseller → 403 (data agregat seluruh pelanggan)', async () => {
      await call('get', '/api/dashboard', tokens.resseler).expect(403);
    });
  });

  describe('/api/auth — profil sendiri untuk semua role', () => {
    it('tanpa token → 401', async () => {
      await call('post', '/api/auth/profile').send({ name: 'X' }).expect(401);
    });

    it('email tidak bisa diubah lewat endpoint profil', async () => {
      // POST default Nest = 201. Yang diuji: field email diabaikan controller.
      const res = await call('post', '/api/auth/profile', realAdminToken)
        .send({ name: 'Administrator', email: 'diubah@test.local' })
        .expect(201);

      expect(res.body.user?.email).toBe('admin@jawara-billing.com');
    });
  });

  describe('endpoint publik tetap publik', () => {
    it('/api/health tanpa token → 200', async () => {
      await call('get', '/api/health').expect(200);
    });
  });
});

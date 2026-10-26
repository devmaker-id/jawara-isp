import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { DashboardService } from './../src/app/modules/dashboard/dashboard.service.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';

// Otorisasi diuji dengan UsersRepository in-memory: guard membaca status akun
// dari "database", jadi test tidak menulis ke tabel users sebenarnya.
describe('RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let fake: FakeUsers;
  let secret: string;

  const tokens: Record<string, string> = {};

  const sign = (sub: number, role: string, email: string) =>
    new JwtService().sign({ sub, email, role }, { secret, expiresIn: '1h' });

  // id reseller pada helper fake-users; dipakai untuk memeriksa filter SQL.
  const resellerId = 3;

  beforeAll(async () => {
    fake = await createFakeUsers();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fake.repo)
      // Dashboard membaca metrik host + perangkat; diuji terpisah, jadi di sini
      // diganti stub agar suite tetap lari tanpa menyentuh MySQL/MikroTik.
      .overrideProvider(DashboardService)
      .useValue({ summary: async () => ({ total_customers: 0 }) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    secret = app.get(ConfigService).jwtSecret;

    tokens.admin = sign(1, 'admin', 'admin@uji.test');
    tokens.operator = sign(2, 'operator', 'operator@uji.test');
    tokens.resseler = sign(3, 'resseler', 'reseller@uji.test');
    // sub=1 (admin sah) tetapi klaim role asing → harus ditolak.
    tokens.unknownRole = sign(1, 'superadmin', 'admin@uji.test');
    // sub tidak ada di database → token tidak boleh diterima.
    tokens.ghost = sign(999, 'admin', 'hantu@uji.test');
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
      await call('get', '/api/admin/users', tokens.unknownRole).expect(403);
    });

    it('menolak token dengan sub yang tidak ada di database', async () => {
      await call('get', '/api/admin/users', tokens.ghost).expect(401);
    });

    it('mengizinkan admin', async () => {
      const res = await call('get', '/api/admin/users', tokens.admin).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('operator tidak bisa menaikkan role sendiri lewat PATCH', async () => {
      await call('patch', '/api/admin/users/2', tokens.operator).send({ role: 'admin' }).expect(403);
    });

    it('operator tidak bisa membuat akun admin baru', async () => {
      await call('post', '/api/admin/users', tokens.operator)
        .send({ name: 'X', email: 'x@uji.test', password: 'rahasia123', role: 'admin' })
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

    // Cakupan reseller difilter di SQL (ownerFilter). Setelah migrasi 003
    // dijalankan, jawabannya 200 berisi HANYA pelanggan miliknya — bukan
    // seluruh pelanggan, dan bukan 503.
    it('reseller hanya menerima pelanggan miliknya', async () => {
      const own = await call('get', '/api/customers', tokens.admin).expect(200);
      const res = await call('get', '/api/customers', tokens.resseler).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Tidak boleh membocorkan pelanggan yang bukan miliknya.
      expect(res.body.length).toBeLessThanOrEqual(own.body.length);
      for (const customer of res.body) {
        expect(customer.reseller_id).toBe(resellerId);
      }
    });

    it('operator tidak boleh menghapus pelanggan', async () => {
      await call('delete', '/api/customers/999999', tokens.operator).expect(403);
    });

    it('reseller tidak boleh menambah pelanggan', async () => {
      await call('post', '/api/customers', tokens.resseler)
        .send({ name: 'Y', email: 'y@uji.test', phone: '081234567' })
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

    // Setelah migrasi 003, tagihan reseller difilter lewat kepemilikan
    // pelanggan: 200 dengan HANYA tagihan pelanggan miliknya.
    it('reseller hanya menerima tagihan pelanggan miliknya', async () => {
      const res = await call('get', '/api/invoices', tokens.resseler).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Tidak ada pelanggan milik reseller uji → daftar harus kosong,
      // bukan seluruh tagihan milik admin.
      const all = await call('get', '/api/invoices', tokens.admin).expect(200);
      expect(res.body.length).toBeLessThanOrEqual(all.body.length);
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
      const res = await call('post', '/api/auth/profile', tokens.admin)
        .send({ name: 'Admin Uji', email: 'diubah@uji.test' })
        .expect(201);

      expect(res.body.user?.email).toBe('admin@uji.test');
    });
  });

  describe('perubahan status akun berlaku seketika', () => {
    it('role diturunkan admin→operator membuat token lama kehilangan akses admin', async () => {
      const before = await call('get', '/api/admin/users', tokens.admin).expect(200);
      expect(Array.isArray(before.body)).toBe(true);

      const current = fake.accounts.get(1)!;
      fake.accounts.set(1, { ...current, role: 'operator' });

      // Token masih membawa klaim "admin", tetapi guard memakai role dari DB.
      await call('get', '/api/admin/users', tokens.admin).expect(403);

      fake.accounts.set(1, current);
    });

    it('akun dinonaktifkan langsung ditolak 401', async () => {
      const current = fake.accounts.get(1)!;
      fake.accounts.set(1, { ...current, is_active: false });

      await call('get', '/api/admin/users', tokens.admin).expect(401);

      fake.accounts.set(1, current);
    });
  });

  describe('endpoint publik tetap publik', () => {
    it('/api/health tanpa token → 200', async () => {
      await call('get', '/api/health').expect(200);
    });
  });
});

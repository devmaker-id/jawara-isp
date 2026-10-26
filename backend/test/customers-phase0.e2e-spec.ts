import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { CustomersRepository } from './../src/app/modules/customers/customers.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';
import { createFakeCustomers, FakeCustomers } from './helpers/fake-customers.js';

// Fase 0: pagination/pencarian pelanggan, kepemilikan pelanggan (admin-only),
// dan pengamanan penghapusan. Kedua repository diganti versi in-memory →
// tidak ada tulisan ke database produksi.
describe('Customers Fase 0 (e2e)', () => {
  let app: INestApplication<App>;
  let users: FakeUsers;
  let customers: FakeCustomers;
  const tokens: Record<string, string> = {};

  const sign = (sub: number, role: string, email: string) =>
    new JwtService().sign({ sub, email, role }, { secret: tokens.secret, expiresIn: '1h' });

  beforeAll(async () => {
    users = await createFakeUsers();
    customers = createFakeCustomers({ ownerColumn: false });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(users.repo)
      .overrideProvider(CustomersRepository)
      .useValue(customers.repo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    tokens.secret = app.get(ConfigService).jwtSecret;
    tokens.admin = sign(1, 'admin', 'admin@uji.test');
    tokens.operator = sign(2, 'operator', 'operator@uji.test');
    tokens.reseller = sign(3, 'resseler', 'reseller@uji.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('pagination & pencarian server-side', () => {
    it('tanpa page tetap array (kompatibel)', async () => {
      const res = await call('get', '/api/customers', tokens.admin).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('dengan page mengembalikan rows/total/page/limit', async () => {
      const res = await call('get', '/api/customers?page=1&limit=2', tokens.admin).expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(res.body.rows).toHaveLength(2);
    });

    it('search dan filter status menyaring hasil sekaligus total', async () => {
      const bySearch = await call('get', '/api/customers?page=1&search=siti', tokens.admin);
      expect(bySearch.body.total).toBe(1);
      expect(bySearch.body.rows[0].email).toBe('siti@uji.test');

      const byStatus = await call('get', '/api/customers?page=1&status=inactive', tokens.admin);
      expect(byStatus.body.total).toBe(0);
    });

    it('menolak limit di luar batas dan page tidak valid', async () => {
      await call('get', '/api/customers?page=1&limit=201', tokens.admin).expect(400);
      await call('get', '/api/customers?page=0', tokens.admin).expect(400);
      await call('get', '/api/customers?page=1&status=ngawur', tokens.admin).expect(400);
    });

    it('operator tetap boleh membaca daftar (termasuk tanpa pemilik)', async () => {
      await call('get', '/api/customers?page=1', tokens.operator).expect(200);
    });

    // Perubahan kontrak Fase 1: reseller BOLEH membaca, tetapi cakupannya
    // difilter di SQL berdasarkan akun terautentikasi. Di sini repository-nya
    // fake (tanpa filter pemilik), sehingga yang diuji hanya lapisan role;
    // pembuktian filter SQL ada di test/reseller-isolation.int-spec.ts.
    it('reseller boleh membaca daftar pelanggan (cakupan diuji di tes integrasi)', async () => {
      await call('get', '/api/customers?page=1', tokens.reseller).expect(200);
      await call('get', '/api/customers/1', tokens.reseller).expect(200);
    });
  });

  describe('kepemilikan pelanggan', () => {
    it('meta memberi tahu bahwa fitur belum aktif sebelum migrasi', async () => {
      const res = await call('get', '/api/customers/meta', tokens.admin).expect(200);
      expect(res.body).toEqual({ owner_assignment: false });
    });

    it('menolak penetapan pemilik dengan 503 saat kolom reseller_id belum ada', async () => {
      const res = await call('patch', '/api/customers/1/owner', tokens.admin)
        .send({ reseller_id: 3 })
        .expect(503);
      expect(res.body.message).toMatch(/003_customer_reseller_ownership/i);
      // Tidak ada perubahan data maupun audit palsu.
      expect(customers.items.get(1)?.reseller_id).toBeNull();
      expect(customers.audit).toHaveLength(0);
    });

    it('operator dan reseller ditolak 403 (tidak boleh mengubah pemilik)', async () => {
      await call('patch', '/api/customers/1/owner', tokens.operator)
        .send({ reseller_id: 3 })
        .expect(403);
      await call('patch', '/api/customers/1/owner', tokens.reseller)
        .send({ reseller_id: 3 })
        .expect(403);
    });

    it('tanpa token 401', async () => {
      await call('patch', '/api/customers/1/owner').send({ reseller_id: 3 }).expect(401);
    });

    describe('setelah kolom tersedia (simulasi pasca-migrasi)', () => {
      beforeAll(() => {
        customers.setOwnerColumn(true);
      });

      it('admin dapat menetapkan pemilik dan audit mencatat aktor + pemilik lama/baru', async () => {
        const res = await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: 3 })
          .expect(200);

        expect(res.body).toMatchObject({
          ok: true,
          customer_id: 1,
          previous_owner_id: null,
          owner_id: 3,
        });
        expect(customers.items.get(1)?.reseller_id).toBe(3);
        expect(customers.audit).toHaveLength(1);
        expect(customers.audit[0]).toMatchObject({
          user_id: 1,
          action: 'CUSTOMER_OWNER_ASSIGNED',
          details: { customer_id: 1, previous_owner_id: null, new_owner_id: 3, actor_id: 1 },
        });
      });

      it('memindahkan pemilik mencatat pemilik sebelumnya', async () => {
        const res = await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: null })
          .expect(200);
        expect(res.body.previous_owner_id).toBe(3);
        expect(res.body.owner_id).toBeNull();
        expect(customers.audit[1].details).toMatchObject({
          previous_owner_id: 3,
          new_owner_id: null,
        });
      });

      it('menolak reseller ID yang bukan reseller / tidak aktif / tidak ada', async () => {
        // id 2 = operator
        const notReseller = await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: 2 })
          .expect(400);
        expect(notReseller.body.message).toMatch(/bukan reseller/i);

        const ghost = await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: 999 })
          .expect(400);
        expect(ghost.body.message).toMatch(/tidak ditemukan/i);

        const reseller = users.accounts.get(3)!;
        users.accounts.set(3, { ...reseller, is_active: false });
        const inactive = await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: 3 })
          .expect(400);
        expect(inactive.body.message).toMatch(/tidak aktif/i);
        users.accounts.set(3, reseller);
      });

      it('menolak customer ID yang tidak ada dan payload tidak valid', async () => {
        await call('patch', '/api/customers/999/owner', tokens.admin)
          .send({ reseller_id: 3 })
          .expect(404);
        await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: 'abc' })
          .expect(400);
        await call('patch', '/api/customers/1/owner', tokens.admin)
          .send({ reseller_id: 3, owner_id: 1 })
          .expect(400);
      });
    });
  });

  describe('penghapusan pelanggan', () => {
    it('menolak hapus pelanggan yang punya tagihan/sesi layanan (409)', async () => {
      const res = await call('delete', '/api/customers/1', tokens.admin).expect(409);
      expect(res.body.message).toMatch(/Nonaktifkan pelanggan/i);
      expect(customers.items.has(1)).toBe(true);
    });

    it('mengizinkan hapus pelanggan tanpa riwayat', async () => {
      await call('delete', '/api/customers/3', tokens.admin).expect(200);
      expect(customers.items.has(3)).toBe(false);
    });

    it('operator tidak boleh menghapus pelanggan', async () => {
      await call('delete', '/api/customers/2', tokens.operator).expect(403);
      expect(customers.items.has(2)).toBe(true);
    });
  });

  describe('penonaktifan tidak menghapus riwayat', () => {
    it('PATCH is_active=false menyisakan pelanggan, tagihan, dan sesi', async () => {
      const res = await call('patch', '/api/customers/1', tokens.operator)
        .send({ is_active: false })
        .expect(200);
      expect(res.body.is_active).toBe(false);
      expect(customers.items.get(1)).toBeDefined();
      expect(customers.relations.get(1)).toEqual({ invoices: 2, services: 1 });
    });
  });
});
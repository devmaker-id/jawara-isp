import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { createFakeUsers, FakeUsers, TEST_PASSWORD } from './helpers/fake-users.js';

// Menu Pengguna: kontrak HTTP untuk daftar/paginasi, CRUD, dan aturan
// pengamanan akun (admin terakhir, akun sendiri, akun berjejak).
// UsersRepository diganti versi in-memory → tidak ada tulisan ke DB nyata.
describe('Manajemen pengguna (e2e)', () => {
  let app: INestApplication<App>;
  let fake: FakeUsers;
  const tokens: Record<string, string> = {};
  let secret: string;

  const sign = (sub: number, role: string, email: string) =>
    new JwtService().sign({ sub, email, role }, { secret, expiresIn: '1h' });

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

    secret = app.get(ConfigService).jwtSecret;
    tokens.admin = sign(1, 'admin', 'admin@uji.test');
    tokens.operator = sign(2, 'operator', 'operator@uji.test');
    tokens.resseler = sign(3, 'resseler', 'reseller@uji.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token?: string,
  ) => {
    const req = request(app.getHttpServer())[method](path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('otorisasi', () => {
    it('menolak tanpa token', async () => {
      await call('get', '/api/admin/users?page=1').expect(401);
    });

    it('operator dan reseller tidak bisa membaca daftar', async () => {
      await call('get', '/api/admin/users?page=1', tokens.operator).expect(403);
      await call('get', '/api/admin/users?page=1', tokens.resseler).expect(403);
    });

    it('operator tidak bisa membuat, mengubah, atau menghapus akun', async () => {
      await call('post', '/api/admin/users', tokens.operator)
        .send({ name: 'X', email: 'x@uji.test', password: 'rahasia123', role: 'admin' })
        .expect(403);
      await call('patch', '/api/admin/users/2', tokens.operator)
        .send({ role: 'admin' })
        .expect(403);
      await call('delete', '/api/admin/users/2', tokens.operator).expect(403);
    });
  });

  describe('daftar, pencarian, filter, paginasi', () => {
    it('tanpa page tetap array (kompatibel)', async () => {
      const res = await call('get', '/api/admin/users', tokens.admin).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('dengan page mengembalikan { rows, total, page, limit }', async () => {
      const res = await call('get', '/api/admin/users?page=1&limit=2', tokens.admin).expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(res.body.rows).toHaveLength(2);
    });

    it('pencarian dan filter role/status bekerja', async () => {
      const bySearch = await call('get', '/api/admin/users?page=1&search=operator', tokens.admin);
      expect(bySearch.body.total).toBe(1);
      expect(bySearch.body.rows[0].email).toBe('operator@uji.test');

      const byRole = await call('get', '/api/admin/users?page=1&role=resseler', tokens.admin);
      expect(byRole.body.rows).toHaveLength(1);

      const byStatus = await call('get', '/api/admin/users?page=1&status=inactive', tokens.admin);
      expect(byStatus.body.total).toBe(0);
    });

    it('tidak pernah mengirim password_hash', async () => {
      const res = await call('get', '/api/admin/users?page=1', tokens.admin).expect(200);
      for (const row of res.body.rows) {
        expect(row).not.toHaveProperty('password_hash');
        expect(JSON.stringify(row)).not.toContain('$2');
      }
    });

    it('menolak role dan status asing pada query', async () => {
      await call('get', '/api/admin/users?page=1&role=superadmin', tokens.admin).expect(400);
      await call('get', '/api/admin/users?page=1&status=mati', tokens.admin).expect(400);
    });
  });

  describe('buat dan ubah akun', () => {
    it('menolak email duplikat tanpa peduli kapitalisasi', async () => {
      await call('post', '/api/admin/users', tokens.admin)
        .send({ name: 'Duplikat', email: 'ADMIN@uji.test', password: 'rahasia123', role: 'operator' })
        .expect(409);
    });

    it('membuat akun baru, hash tidak bocor, dan password langsung bisa dipakai login', async () => {
      const created = await call('post', '/api/admin/users', tokens.admin)
        .send({
          name: 'Kasir Baru',
          email: 'Kasir@Uji.Test',
          password: 'rahasiaBaru123',
          role: 'operator',
          is_active: true,
        })
        .expect(201);

      expect(created.body).toMatchObject({ name: 'Kasir Baru', email: 'kasir@uji.test', role: 'operator' });
      expect(created.body).not.toHaveProperty('password_hash');

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'kasir@uji.test', password: 'rahasiaBaru123' })
        .expect(200);
    });

    it('reseller disimpan dengan nilai enum yang sah', async () => {
      const res = await call('post', '/api/admin/users', tokens.admin)
        .send({ name: 'Mitra', email: 'mitra@uji.test', password: 'rahasia123', role: 'resseler' })
        .expect(201);
      expect(res.body.role).toBe('resseler');

      await call('post', '/api/admin/users', tokens.admin)
        .send({ name: 'Salah', email: 'salah@uji.test', password: 'rahasia123', role: 'reseller' })
        .expect(400);
    });

    it('reset kata sandi lewat PATCH: hash baru, login lama ditolak', async () => {
      const target = [...fake.accounts.values()].find((u) => u.email === 'operator@uji.test')!;
      const res = await call('patch', `/api/admin/users/${target.id}`, tokens.admin)
        .send({ password: 'sandiBaru#2026' })
        .expect(200);
      expect(res.body).not.toHaveProperty('password_hash');

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'operator@uji.test', password: 'sandiBaru#2026' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'operator@uji.test', password: TEST_PASSWORD })
        .expect(401);
    });
  });

  describe('pengamanan akun', () => {
    it('admin tidak bisa mengubah role sendiri', async () => {
      const res = await call('patch', '/api/admin/users/1', tokens.admin)
        .send({ role: 'operator' })
        .expect(403);
      expect(res.body.message).toMatch(/role akun sendiri/i);
    });

    it('admin tidak bisa menonaktifkan akun sendiri', async () => {
      await call('patch', '/api/admin/users/1', tokens.admin).send({ is_active: false }).expect(403);
    });

    // Aturan "admin aktif terakhir" tidak bisa dipicu lewat HTTP karena aktor
    // yang sah selalu admin aktif lain (jadi target bukan yang terakhir).
    // Aturan itu diuji langsung di level service pada
    // test/admin-users-guard.spec.ts.
    it('akun yang punya jejak audit tidak boleh dihapus', async () => {
      const target = [...fake.accounts.values()].find((u) => u.email === 'mitra@uji.test')!;
      fake.references.set(target.id, 2);

      const res = await call('delete', `/api/admin/users/${target.id}`, tokens.admin).expect(409);
      expect(res.body.message).toMatch(/Nonaktifkan akun/i);

      fake.references.delete(target.id);
      await call('delete', `/api/admin/users/${target.id}`, tokens.admin).expect(200);
    });

    it('tidak bisa menghapus akun sendiri', async () => {
      await call('delete', '/api/admin/users/1', tokens.admin).expect(403);
    });
  });
});
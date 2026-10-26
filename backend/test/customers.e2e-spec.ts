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
import {
  assertSafeTestDatabase,
  isProductionDatabase,
  resolveDatabaseTarget,
} from './helpers/test-db-guard.js';

// Route + guard JWT diuji lewat HTTP, TETAPI seluruh repository diganti versi
// in-memory. Tidak ada query ke MySQL produksi dari file ini: sebelumnya spec
// ini memakai CustomersRepository asli dan mengirim POST /api/customers.
describe('Customers (e2e, repository in-memory)', () => {
  let app: INestApplication<App>;
  let users: FakeUsers;
  let customers: FakeCustomers;
  let token: string;

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

    // Jaring pengaman: provider yang dipakai harus benar-benar fake, bukan
    // repository MySQL yang bisa menulis ke database produksi.
    expect(moduleFixture.get(CustomersRepository)).toBe(
      customers.repo as unknown as CustomersRepository,
    );
    expect(moduleFixture.get(UsersRepository)).toBe(users.repo as unknown as UsersRepository);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const admin = [...users.accounts.values()].find((u) => u.role === 'admin')!;
    token = new JwtService().sign(
      { sub: admin.id, email: admin.email, role: admin.role },
      { secret: app.get(ConfigService).jwtSecret, expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  it('guard menolak konfigurasi database produksi untuk tes tulis', () => {
    const current = resolveDatabaseTarget();
    if (isProductionDatabase(current)) {
      // Konfigurasi saat ini menunjuk produksi → guard WAJIB menolak.
      expect(() => assertSafeTestDatabase('write', current)).toThrow(/database produksi/i);
    } else {
      expect(assertSafeTestDatabase('write', current)).toEqual(current);
    }
  });

  it('menolak akses tanpa token (401)', async () => {
    await request(app.getHttpServer()).get('/api/customers').expect(401);
  });

  it('mengembalikan daftar pelanggan sebagai array saat terautentikasi', async () => {
    const response = await auth(request(app.getHttpServer()).get('/api/customers')).expect(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('menerima pagination dan total memakai filter yang sama', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/customers?page=1&limit=1'),
    ).expect(200);
    expect(response.body).toMatchObject({ page: 1, limit: 1 });
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.total).toBe(customers.items.size);
  });

  it('menolak payload tidak valid dengan 400 tanpa menyimpan apa pun', async () => {
    const before = customers.items.size;
    await auth(
      request(app.getHttpServer())
        .post('/api/customers')
        .send({ name: 'X', email: 'bukan-email', phone: '123' }),
    ).expect(400);
    expect(customers.items.size).toBe(before);
  });

  it('menolak field di luar kontrak DTO dengan 400 tanpa menyimpan apa pun', async () => {
    const before = customers.items.size;
    await auth(
      request(app.getHttpServer())
        .post('/api/customers')
        .send({ name: 'X', email: 'x@example.test', phone: '081234567', role: 'admin' }),
    ).expect(400);
    expect(customers.items.size).toBe(before);
  });

  it('membuat pelanggan pada repository in-memory (bukan database)', async () => {
    const response = await auth(
      request(app.getHttpServer()).post('/api/customers').send({
        name: 'Pelanggan Tes',
        email: 'pelanggan.tes@uji.test',
        phone: '081200000000',
        address: 'Jl. Tes 1',
      }),
    ).expect(201);

    expect(response.body).toMatchObject({ email: 'pelanggan.tes@uji.test' });
    expect([...customers.items.values()].some((c) => c.email === 'pelanggan.tes@uji.test')).toBe(
      true,
    );
  });

  it('memperbarui pelanggan in-memory lewat PATCH', async () => {
    const response = await auth(
      request(app.getHttpServer()).patch('/api/customers/2').send({ name: 'Siti Aminah Diubah' }),
    ).expect(200);
    expect(response.body.name).toBe('Siti Aminah Diubah');
  });

  it('menghapus pelanggan tanpa riwayat hanya dari repository in-memory', async () => {
    // id 3 pada fixture = pelanggan tanpa relasi.
    await auth(request(app.getHttpServer()).delete('/api/customers/3')).expect(200);
    expect(customers.items.has(3)).toBe(false);
  });

  it('mengembalikan 404 untuk pelanggan yang tidak ada', async () => {
    await auth(request(app.getHttpServer()).get('/api/customers/999999')).expect(404);
  });
});
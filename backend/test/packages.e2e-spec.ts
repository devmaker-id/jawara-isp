import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { PackagesRepository } from './../src/app/modules/packages/packages.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';
import { createFakePackages, FakePackages } from './helpers/fake-packages.js';

// CRUD paket diuji lewat HTTP dengan UsersRepository dan PackagesRepository
// in-memory: tidak ada penulisan ke tabel production.
describe('Packages (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let fakePackages: FakePackages;
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();
    fakePackages = createFakePackages();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(PackagesRepository)
      .useValue(fakePackages.repo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const secret = app.get(ConfigService).jwtSecret;
    const sign = (sub: number, role: string, email: string) =>
      new JwtService().sign({ sub, email, role }, { secret, expiresIn: '1h' });

    adminToken = sign(1, 'admin', 'admin@uji.test');
    operatorToken = sign(2, 'operator', 'operator@uji.test');
    resellerToken = sign(3, 'resseler', 'reseller@uji.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const validPayload = {
    name: '30Mbps Unlimited',
    description: 'Paket tanpa batas',
    price: 49500.5,
    data_limit: 'Unlimited',
    speed: 30,
    valid_days: 30,
  };

  describe('pembacaan', () => {
    it('tanpa token → 401', async () => {
      await api().get('/api/packages').expect(401);
    });

    it('daftar kosong → array kosong untuk semua role', async () => {
      for (const token of [adminToken, operatorToken, resellerToken]) {
        const res = await api().get('/api/packages').set(auth(token)).expect(200);
        expect(Array.isArray(res.body)).toBe(true);
      }
    });

    it('operator dan reseller boleh membaca katalog', async () => {
      await api().get('/api/packages').set(auth(operatorToken)).expect(200);
      await api().get('/api/packages').set(auth(resellerToken)).expect(200);
    });
  });

  describe('mutasi hanya admin', () => {
    it('operator tidak boleh menambah paket (403)', async () => {
      await api().post('/api/packages').set(auth(operatorToken)).send(validPayload).expect(403);
    });

    it('reseller tidak boleh menambah paket (403)', async () => {
      await api().post('/api/packages').set(auth(resellerToken)).send(validPayload).expect(403);
    });

    it('operator tidak boleh mengubah paket (403)', async () => {
      await api().patch('/api/packages/1').set(auth(operatorToken)).send({ price: 1 }).expect(403);
    });

    it('reseller tidak boleh menghapus paket (403)', async () => {
      await api().delete('/api/packages/1').set(auth(resellerToken)).expect(403);
    });
  });

  describe('CRUD sebagai admin', () => {
    let createdId: number;

    it('create → 201 dengan data yang dikirim', async () => {
      const res = await api().post('/api/packages').set(auth(adminToken)).send(validPayload).expect(201);

      expect(res.body.name).toBe(validPayload.name);
      expect(res.body.price).toBe(49500.5);
      expect(res.body.speed).toBe(30);
      expect(res.body.is_active).toBe(true);
      createdId = res.body.id;
    });

    it('list memuat paket yang baru dibuat', async () => {
      const res = await api().get('/api/packages').set(auth(adminToken)).expect(200);
      expect(res.body.some((p: { id: number }) => p.id === createdId)).toBe(true);
    });

    it('get by id → 200', async () => {
      const res = await api().get(`/api/packages/${createdId}`).set(auth(adminToken)).expect(200);
      expect(res.body.id).toBe(createdId);
    });

    it('patch mempertahankan harga desimal tanpa kehilangan presisi', async () => {
      const res = await api()
        .patch(`/api/packages/${createdId}`)
        .set(auth(adminToken))
        .send({ price: 1234567.99 })
        .expect(200);

      expect(res.body.price).toBe(1234567.99);
      expect(res.body.price.toFixed(2)).toBe('1234567.99');
      expect(res.body.name).toBe(validPayload.name);
    });

    it('patch tanpa nama tidak ditolak (field opsional)', async () => {
      await api().patch(`/api/packages/${createdId}`).set(auth(adminToken)).send({ is_active: false }).expect(200);
    });

    it('delete → ok, lalu get by id → 404', async () => {
      await api().delete(`/api/packages/${createdId}`).set(auth(adminToken)).expect(200);
      await api().get(`/api/packages/${createdId}`).set(auth(adminToken)).expect(404);
    });
  });

  describe('validasi input', () => {
    it('menolak nama terlalu pendek (400)', async () => {
      await api()
        .post('/api/packages')
        .set(auth(adminToken))
        .send({ ...validPayload, name: 'A' })
        .expect(400);
    });

    it('menolak harga negatif (400)', async () => {
      await api()
        .post('/api/packages')
        .set(auth(adminToken))
        .send({ ...validPayload, name: 'Negatif', price: -1 })
        .expect(400);
    });

    it('menolak harga dengan lebih dari 2 desimal (400)', async () => {
      await api()
        .post('/api/packages')
        .set(auth(adminToken))
        .send({ ...validPayload, name: 'Tiga Desimal', price: 1000.999 })
        .expect(400);
    });

    it('menolak speed bukan bilangan bulat (400)', async () => {
      await api()
        .post('/api/packages')
        .set(auth(adminToken))
        .send({ ...validPayload, name: 'Speed Desimal', speed: 10.5 })
        .expect(400);
    });

    it('menolak valid_days nol (400)', async () => {
      await api()
        .post('/api/packages')
        .set(auth(adminToken))
        .send({ ...validPayload, name: 'Nol Hari', valid_days: 0 })
        .expect(400);
    });

    it('menolak field di luar kontrak DTO (400)', async () => {
      await api()
        .post('/api/packages')
        .set(auth(adminToken))
        .send({ ...validPayload, name: 'Field Asing', role: 'admin' })
        .expect(400);
    });

    it('menolak ID tidak valid (400)', async () => {
      await api().get('/api/packages/abc').set(auth(adminToken)).expect(400);
    });

    it('nama duplikat → 409', async () => {
      await api().post('/api/packages').set(auth(adminToken)).send(validPayload).expect(201);
      await api().post('/api/packages').set(auth(adminToken)).send(validPayload).expect(409);
    });
  });

  describe('ID tidak ditemukan', () => {
    it('get → 404', async () => {
      await api().get('/api/packages/999999').set(auth(adminToken)).expect(404);
    });

    it('patch → 404', async () => {
      await api().patch('/api/packages/999999').set(auth(adminToken)).send({ price: 100 }).expect(404);
    });

    it('delete → 404', async () => {
      await api().delete('/api/packages/999999').set(auth(adminToken)).expect(404);
    });
  });
});

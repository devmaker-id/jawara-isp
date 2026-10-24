import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';

// Uji integrasi nyata: route, guard JWT, dan query MySQL pada tabel customers.
// UsersRepository diganti versi in-memory agar test tidak menulis ke tabel users.
describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let fake: FakeUsers;
  let token: string;

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

    const admin = [...fake.accounts.values()].find((u) => u.role === 'admin')!;
    token = new JwtService().sign(
      { sub: admin.id, email: admin.email, role: admin.role },
      { secret: app.get(ConfigService).jwtSecret, expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('menolak akses tanpa token (401)', async () => {
    await request(app.getHttpServer()).get('/api/customers').expect(401);
  });

  it('mengembalikan daftar pelanggan sebagai array saat terautentikasi', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
  });

  it('menolak payload tidak valid dengan 400 (validasi server)', async () => {
    await request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', email: 'bukan-email', phone: '123' })
      .expect(400);
  });

  it('menolak field di luar kontrak DTO dengan 400', async () => {
    await request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', email: 'x@example.test', phone: '081234567', role: 'admin' })
      .expect(400);
  });

  it('mengembalikan 404 untuk pelanggan yang tidak ada', async () => {
    await request(app.getHttpServer())
      .get('/api/customers/999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

// Uji integrasi nyata: route, guard JWT, dan query MySQL.
// Tidak membuat/menghapus data pelanggan agar database tidak tercemar.
describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@jawara-billing.com', password: 'password123' });

    token = login.body.token;
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

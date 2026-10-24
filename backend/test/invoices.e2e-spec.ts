import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { InvoicesRepository } from './../src/app/modules/invoices/invoices.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';
import { createFakeInvoices, FakeInvoices } from './helpers/fake-invoices.js';

// CRUD tagihan + alur pembayaran diuji lewat HTTP dengan UsersRepository dan
// InvoicesRepository in-memory: tidak ada penulisan ke tabel produksi.
describe('Invoices (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let fakeInvoices: FakeInvoices;
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;

  const ISO_TODAY = new Date().toISOString().slice(0, 10);
  const FUTURE = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();
    fakeInvoices = createFakeInvoices();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(InvoicesRepository)
      .useValue(fakeInvoices.repo)
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
    customer_id: 1,
    amount: 29700.5,
    due_date: '2026-12-31',
    description: 'Tagihan uji',
  };

  describe('otorisasi', () => {
    it('tanpa token → 401', async () => {
      await api().get('/api/invoices').expect(401);
    });

    it('resseler tidak boleh membaca tagihan → 403', async () => {
      await api().get('/api/invoices').set(auth(resellerToken)).expect(403);
      await api().get('/api/invoices/summary').set(auth(resellerToken)).expect(403);
    });

    it('resseler tidak boleh membuat tagihan → 403', async () => {
      await api().post('/api/invoices').set(auth(resellerToken)).send(validPayload).expect(403);
    });

    it('operator boleh membaca daftar dan ringkasan', async () => {
      await api().get('/api/invoices').set(auth(operatorToken)).expect(200);
      await api().get('/api/invoices/summary').set(auth(operatorToken)).expect(200);
    });

    it('operator tidak boleh menghapus tagihan → 403', async () => {
      await api().delete('/api/invoices/1').set(auth(operatorToken)).expect(403);
    });
  });

  describe('CRUD tagihan', () => {
    let id: number;

    it('operator membuat tagihan → 201, nomor dan nama pelanggan dari server', async () => {
      const res = await api().post('/api/invoices').set(auth(operatorToken)).send(validPayload).expect(201);
      expect(res.body.invoice_number).toMatch(/^INV-\d{4}-\d{4}$/);
      expect(res.body.customer_id).toBe(1);
      expect(res.body.customer_name).toBe('Pelanggan Uji Satu');
      expect(res.body.amount).toBe(29700.5);
      expect(res.body.status).toBe('unpaid');
      expect(res.body.paid_date).toBeNull();
      id = res.body.id;
    });

    it('daftar memuat tagihan baru dan ringkasan menghitungnya', async () => {
      const list = await api().get('/api/invoices').set(auth(adminToken)).expect(200);
      expect(list.body.some((i: { id: number }) => i.id === id)).toBe(true);

      const summary = await api().get('/api/invoices/summary').set(auth(adminToken)).expect(200);
      expect(summary.body.total).toBeGreaterThanOrEqual(29700.5);
      expect(summary.body.unpaid).toBeGreaterThanOrEqual(1);
      expect(typeof summary.body.paid).toBe('number');
      expect(typeof summary.body.overdue).toBe('number');
    });

    it('detail by id → 200', async () => {
      const res = await api().get(`/api/invoices/${id}`).set(auth(adminToken)).expect(200);
      expect(res.body.id).toBe(id);
    });

    it('patch nominal dan deskripsi → 200', async () => {
      const res = await api()
        .patch(`/api/invoices/${id}`)
        .set(auth(operatorToken))
        .send({ amount: 15000.75, description: 'revisi' })
        .expect(200);
      expect(res.body.amount).toBe(15000.75);
      expect(res.body.description).toBe('revisi');
    });

    it('patch status paid ditolak → 400 (harus lewat endpoint pembayaran)', async () => {
      await api().patch(`/api/invoices/${id}`).set(auth(adminToken)).send({ status: 'paid' }).expect(400);
    });

    it('hapus oleh admin → 200, lalu detail → 404', async () => {
      await api().delete(`/api/invoices/${id}`).set(auth(adminToken)).expect(200);
      await api().get(`/api/invoices/${id}`).set(auth(adminToken)).expect(404);
    });
  });

  describe('validasi input', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['amount negatif', { ...validPayload, amount: -1 }],
      ['amount nol', { ...validPayload, amount: 0 }],
      ['amount 3 desimal', { ...validPayload, amount: 10.999 }],
      ['amount bukan angka', { ...validPayload, amount: 'seribu' }],
      ['tanggal bukan format YYYY-MM-DD', { ...validPayload, due_date: '2026-12-31T10:00:00Z' }],
      ['tanggal tidak ada di kalender', { ...validPayload, due_date: '2026-02-30' }],
      ['customer_id bukan bilangan bulat', { ...validPayload, customer_id: 1.5 }],
      ['field asing', { ...validPayload, paid: true }],
    ];

    for (const [label, body] of bad) {
      it(`menolak ${label} → 400`, async () => {
        await api().post('/api/invoices').set(auth(adminToken)).send(body).expect(400);
      });
    }

    it('menolak ID tidak valid → 400', async () => {
      await api().get('/api/invoices/abc').set(auth(adminToken)).expect(400);
    });

    it('menolak pelanggan yang tidak ada → 404', async () => {
      await api()
        .post('/api/invoices')
        .set(auth(adminToken))
        .send({ ...validPayload, customer_id: 999 })
        .expect(404);
    });
  });

  describe('alur pembayaran', () => {
    let id: number;

    beforeAll(async () => {
      const res = await api()
        .post('/api/invoices')
        .set(auth(adminToken))
        .send({ customer_id: 2, amount: 1000, due_date: '2026-12-01' });
      id = res.body.id;
    });

    it('menolak pembayaran melebihi sisa tagihan → 400', async () => {
      await api().post(`/api/invoices/${id}/pay`).set(auth(operatorToken)).send({ amount: 1000.01 }).expect(400);
    });

    it('menolak pembayaran parsial → 409 dengan alasan skema', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/pay`)
        .set(auth(operatorToken))
        .send({ amount: 400 })
        .expect(409);
      expect(res.body.message).toMatch(/tabel payments/);
    });

    it('menolak tanggal pembayaran di masa depan → 400', async () => {
      await api()
        .post(`/api/invoices/${id}/pay`)
        .set(auth(operatorToken))
        .send({ amount: 1000, paid_date: FUTURE })
        .expect(400);
    });

    it('menolak amount tidak valid → 400', async () => {
      await api().post(`/api/invoices/${id}/pay`).set(auth(operatorToken)).send({ amount: 0 }).expect(400);
      await api()
        .post(`/api/invoices/${id}/pay`)
        .set(auth(operatorToken))
        .send({ amount: 1000.123 })
        .expect(400);
    });

    it('pembayaran penuh oleh operator → 200, status paid, paid_date terisi', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/pay`)
        .set(auth(operatorToken))
        .send({ amount: 1000, paid_date: ISO_TODAY })
        .expect(200);
      expect(res.body.status).toBe('paid');
      expect(res.body.paid_date).toBe(ISO_TODAY);
    });

    it('pembayaran kedua ditolak → 409 sudah lunas', async () => {
      await api().post(`/api/invoices/${id}/pay`).set(auth(adminToken)).send({ amount: 1000 }).expect(409);
    });

    it('tagihan lunas tidak boleh diubah nominalnya → 409', async () => {
      await api().patch(`/api/invoices/${id}`).set(auth(adminToken)).send({ amount: 2000 }).expect(409);
    });

    it('pembayaran untuk ID tidak ada → 404', async () => {
      await api().post('/api/invoices/999999/pay').set(auth(adminToken)).send({ amount: 10 }).expect(404);
    });
  });

  describe('ID tidak ditemukan', () => {
    it('get / patch / delete → 404', async () => {
      await api().get('/api/invoices/999999').set(auth(adminToken)).expect(404);
      await api().patch('/api/invoices/999999').set(auth(adminToken)).send({ amount: 10 }).expect(404);
      await api().delete('/api/invoices/999999').set(auth(adminToken)).expect(404);
    });
  });
});
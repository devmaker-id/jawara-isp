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
import { PaymentsRepository } from './../src/app/modules/payments/payments.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';
import { createFakeInvoices, FakeInvoices } from './helpers/fake-invoices.js';
import { createFakePayments, FakePayments } from './helpers/fake-payments.js';

// Ledger pembayaran diuji lewat HTTP dengan repository in-memory: tidak ada
// penulisan ke tabel payments/invoices produksi. Constraint FK RESTRICT dan
// UNIQUE(invoice_id, idempotency_key) sendiri sudah dibuktikan di instance
// MariaDB terpisah, bukan di sini.
describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let fakeInvoices: FakeInvoices;
  let fakePayments: FakePayments;
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();
    fakeInvoices = createFakeInvoices();
    fakePayments = createFakePayments(fakeInvoices);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(InvoicesRepository)
      .useValue(fakeInvoices.repo)
      .overrideProvider(PaymentsRepository)
      .useValue(fakePayments.repo)
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

  const makeInvoice = async (amount: number): Promise<number> => {
    const res = await api()
      .post('/api/invoices')
      .set(auth(adminToken))
      .send({ customer_id: 1, amount, due_date: '2026-12-01' })
      .expect(201);
    return res.body.id;
  };

  describe('otorisasi', () => {
    it('tanpa token → 401', async () => {
      await api().get('/api/invoices/1/payments').expect(401);
    });

    it('resseler boleh membaca pembayaran tetapi tidak boleh mencatat → 403 saat menulis', async () => {
      const id = await makeInvoice(1000);
      await api().get(`/api/invoices/${id}/payments`).set(auth(resellerToken)).expect(200);
      await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(resellerToken))
        .send({ amount: 100 })
        .expect(403);
    });

    it('void hanya untuk admin: operator → 403', async () => {
      const id = await makeInvoice(1000);
      const created = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 1000 })
        .expect(201);
      await api()
        .post(`/api/payments/${created.body.payment.id}/void`)
        .set(auth(operatorToken))
        .send({ reason: 'salah input' })
        .expect(403);
    });
  });

  describe('pembayaran parsial dan pelunasan', () => {
    let id: number;

    beforeAll(async () => {
      id = await makeInvoice(1000);
    });

    it('pembayaran sebagian diterima → 201 dengan status partial', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 400, method: 'transfer', reference: 'TRX-1', note: 'cicilan 1' })
        .expect(201);

      expect(res.body.payment.amount).toBe(400);
      expect(res.body.payment.method).toBe('transfer');
      expect(res.body.payment.recorded_by).toBe(2);
      expect(res.body.invoice.status).toBe('partial');
      expect(res.body.invoice.paid_date).toBeNull();
    });

    it('pelunasan sisa membuat status paid dan paid_date terisi', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 600 })
        .expect(201);

      expect(res.body.invoice.status).toBe('paid');
      expect(res.body.invoice.paid_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('pembayaran setelah lunas → 409', async () => {
      await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(adminToken))
        .send({ amount: 100 })
        .expect(409);
    });

    it('nominal melebihi sisa → 400', async () => {
      const other = await makeInvoice(1000);
      const error = await api()
        .post(`/api/invoices/${other}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 1000.01 })
        .expect(400);
      expect(error.body.message).toMatch(/melebihi sisa tagihan/);
    });

    it('amount tidak valid → 400', async () => {
      const other = await makeInvoice(1000);
      await api()
        .post(`/api/invoices/${other}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 0 })
        .expect(400);
      await api()
        .post(`/api/invoices/${other}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 10.123 })
        .expect(400);
    });

    it('tagihan tidak ada → 404', async () => {
      await api()
        .post('/api/invoices/999999/payments')
        .set(auth(adminToken))
        .send({ amount: 10 })
        .expect(404);
    });
  });

  describe('idempotensi kunci', () => {
    const key = 'kunci-uji-0001';
    let id: number;

    beforeAll(async () => {
      id = await makeInvoice(1000);
    });

    it('kirim pertama → 201', async () => {
      await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 250, idempotency_key: key })
        .expect(201);
    });

    it('kirim ulang kunci sama → 200 dan tidak menambah baris', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 250, idempotency_key: key })
        .expect(200);
      const list = await api().get(`/api/invoices/${id}/payments`).set(auth(operatorToken));
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(res.body.payment.id);
    });
  });

  describe('void menghitung ulang status dari SUM pembayaran sah', () => {
    let id: number;
    let paymentId: number;
    const key = 'kunci-uji-void-01';

    beforeAll(async () => {
      id = await makeInvoice(1000);
      const res = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 400, idempotency_key: key })
        .expect(201);
      paymentId = res.body.payment.id;
    });

    it('alasan kosong ditolak → 400', async () => {
      await api()
        .post(`/api/payments/${paymentId}/void`)
        .set(auth(adminToken))
        .send({ reason: '   ' })
        .expect(400);
    });

    it('void oleh admin → 200, status kembali unpaid (belum ada pembayaran sah)', async () => {
      const res = await api()
        .post(`/api/payments/${paymentId}/void`)
        .set(auth(adminToken))
        .send({ reason: 'transfer ganda' })
        .expect(200);

      expect(res.body.payment.voided_at).not.toBeNull();
      expect(res.body.payment.void_reason).toBe('transfer ganda');
      expect(res.body.invoice.status).toBe('unpaid');
      expect(res.body.invoice.paid_date).toBeNull();
    });

    it('void kedua → 409', async () => {
      await api()
        .post(`/api/payments/${paymentId}/void`)
        .set(auth(adminToken))
        .send({ reason: 'ulang' })
        .expect(409);
    });

    it('kunci idempoten yang barisnya sudah di-void → 409 (bukan tagihan kedua)', async () => {
      const error = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 400, idempotency_key: key })
        .expect(409);
      expect(error.body.message).toMatch(/dibatalkan/);
    });

    it('riwayat tetap menyimpan baris yang di-void', async () => {
      const res = await api()
        .get(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].voided_at).not.toBeNull();
    });

    it('pembayaran baru setelah void mengembalikan status ke partial', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 300, idempotency_key: 'kunci-uji-void-02' })
        .expect(201);
      expect(res.body.invoice.status).toBe('partial');
    });
  });

  describe('riwayat, ringkasan, dan form pembayaran', () => {
    let invoiceId: number;
    let invoiceNumber: string;

    beforeAll(async () => {
      invoiceId = await makeInvoice(1000);
      await api()
        .post(`/api/invoices/${invoiceId}/payments`)
        .set(auth(operatorToken))
        .send({ amount: 400, method: 'transfer', reference: 'TRX-RIW-1' })
        .expect(201);
      const res = await api().get(`/api/invoices/${invoiceId}`).set(auth(adminToken)).expect(200);
      invoiceNumber = res.body.invoice_number;
    });

    // Fase 1: baca diizinkan (ter-scope di SQL); pembuktian cakupan ada di
    // test/reseller-isolation.int-spec.ts.
    it('resseler boleh membaca riwayat dan ringkasan (cakupan diuji di tes integrasi)', async () => {
      await api().get('/api/payments').set(auth(resellerToken)).expect(200);
      await api().get('/api/payments/summary').set(auth(resellerToken)).expect(200);
      await api().get('/api/payments/payable-invoices').set(auth(resellerToken)).expect(200);
    });

    it('riwayat: filter pencarian, status, dan pagination', async () => {
      const byNumber = await api()
        .get(`/api/payments?search=${encodeURIComponent(invoiceNumber)}`)
        .set(auth(operatorToken))
        .expect(200);
      expect(byNumber.body.total).toBe(1);
      expect(byNumber.body.rows[0].amount).toBe(400);
      expect(byNumber.body.rows[0].invoice_status).toBe('partial');

      const page = await api().get('/api/payments?limit=2&page=1').set(auth(operatorToken)).expect(200);
      expect(page.body.rows).toHaveLength(2);
      expect(page.body.limit).toBe(2);
      expect(page.body.total).toBeGreaterThan(2);

      const voided = await api()
        .get('/api/payments?status=void')
        .set(auth(operatorToken))
        .expect(200);
      expect(voided.body.rows.every((row: { voided_at: string | null }) => row.voided_at !== null)).toBe(
        true,
      );
    });

    it('ringkasan: pemasukan sah dan saldo tagihan', async () => {
      const res = await api().get('/api/payments/summary').set(auth(operatorToken)).expect(200);
      expect(res.body.income).toBeGreaterThan(0);
      expect(res.body.transactions).toBeGreaterThan(0);
      expect(res.body.outstanding).toBeGreaterThan(0);
    });

    it('pilihan invoice hanya yang masih bersisa', async () => {
      const res = await api()
        .get(`/api/payments/payable-invoices?search=${encodeURIComponent(invoiceNumber)}`)
        .set(auth(operatorToken))
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].remaining).toBe(600);
      expect(res.body.rows[0].overdue).toBe(false);
    });

    it('form: POST /api/payments dengan invoice_id, idempoten, lalu lunas', async () => {
      const payload = { invoice_id: invoiceId, amount: 600, method: 'cash', idempotency_key: 'kunci-form-0001' };
      const first = await api().post('/api/payments').set(auth(operatorToken)).send(payload).expect(201);
      expect(first.body.invoice.status).toBe('paid');

      const again = await api().post('/api/payments').set(auth(operatorToken)).send(payload).expect(200);
      expect(again.body.payment.id).toBe(first.body.payment.id);

      const list = await api()
        .get(`/api/invoices/${invoiceId}/payments`)
        .set(auth(operatorToken))
        .expect(200);
      expect(list.body).toHaveLength(2);
    });

    it('validasi form: invoice wajib, nominal > 0, metode dikenal, tidak melebihi sisa', async () => {
      await api().post('/api/payments').set(auth(operatorToken)).send({ amount: 100 }).expect(400);
      await api()
        .post('/api/payments')
        .set(auth(operatorToken))
        .send({ invoice_id: invoiceId, amount: 0 })
        .expect(400);
      await api()
        .post('/api/payments')
        .set(auth(operatorToken))
        .send({ invoice_id: invoiceId, amount: 100, method: 'ewallet' })
        .expect(400);

      const fresh = await makeInvoice(100);
      const over = await api()
        .post('/api/payments')
        .set(auth(operatorToken))
        .send({ invoice_id: fresh, amount: 100.01 })
        .expect(400);
      expect(over.body.message).toMatch(/melebihi sisa tagihan/);
    });
  });
});

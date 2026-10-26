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

// Laporan diuji lewat HTTP dengan repository in-memory. Aturan yang diuji:
// pemasukan hanya dari pembayaran sah per tanggal bayar, sisa tagihan dan
// tunggakan dihitung terpisah dari pemasukan periode.
describe('Reports (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let fakeInvoices: FakeInvoices;
  let fakePayments: FakePayments;
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;
  let partialInvoiceId: number;
  let voidedInvoiceId: number;

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

    const api = () => request(app.getHttpServer());
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    // Invoice A: dibayar sebagian 400 tunai. Invoice B: lunas 500 transfer lalu di-void.
    const a = await api()
      .post('/api/invoices')
      .set(auth(adminToken))
      .send({ customer_id: 1, amount: 1000, due_date: '2026-12-01' });
    partialInvoiceId = a.body.id;
    await api()
      .post('/api/invoices/' + partialInvoiceId + '/payments')
      .set(auth(operatorToken))
      .send({ amount: 400, method: 'cash' })
      .expect(201);

    const b = await api()
      .post('/api/invoices')
      .set(auth(adminToken))
      .send({ customer_id: 2, amount: 500, due_date: '2026-12-15' });
    voidedInvoiceId = b.body.id;
    const paid = await api()
      .post('/api/invoices/' + voidedInvoiceId + '/payments')
      .set(auth(operatorToken))
      .send({ amount: 500, method: 'transfer' })
      .expect(201);
    await api()
      .post('/api/payments/' + paid.body.payment.id + '/void')
      .set(auth(adminToken))
      .send({ reason: 'transfer ganda' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('tanpa token → 401, resseler → 200 (cakupan diuji di tes integrasi)', async () => {
    await api().get('/api/reports?type=summary').expect(401);
    await api()
      .get('/api/reports?type=summary')
      .set(auth(resellerToken))
      .expect(200);
  });

  it('ringkasan: pemasukan sah periode vs saldo tagihan saat ini', async () => {
    const res = await api()
      .get('/api/reports?type=summary')
      .set(auth(operatorToken))
      .expect(200);

    expect(res.body.summary.income).toBe(400);
    expect(res.body.summary.transactions).toBe(1);
    // sisa: A 600 + B 500 (pembayaran B di-void, jadi tidak mengurangi sisa)
    expect(res.body.summary.outstanding).toBe(1100);
    expect(res.body.summary.overdue).toBe(0);
    expect(res.body.rows).toEqual([]);
  });

  it('detail transaksi memuat baris valid dan void, termasuk status tagihan', async () => {
    const res = await api()
      .get('/api/reports?type=transactions&limit=50')
      .set(auth(operatorToken))
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.rows.map((r: { amount: number }) => r.amount).sort()).toEqual([400, 500]);
    expect(res.body.rows.every((r: { invoice_status: string }) => typeof r.invoice_status === 'string')).toBe(
      true,
    );
  });

  it('pemasukan per metode mengabaikan transaksi void', async () => {
    const res = await api()
      .get('/api/reports?type=by-method')
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.by_method).toEqual([{ method: 'cash', transactions: 1, total: 400 }]);
  });

  it('tagihan belum lunas: hanya yang bersisa, dengan sisa dan status jatuh tempo', async () => {
    const res = await api()
      .get('/api/reports?type=unpaid')
      .set(auth(operatorToken))
      .expect(200);

    expect(res.body.total).toBe(2);
    const rows = res.body.rows as Array<{ id: number; remaining: number; overdue: boolean }>;
    const partial = rows.find((r) => r.id === partialInvoiceId);
    const voidedLine = rows.find((r) => r.id === voidedInvoiceId);
    expect(partial?.remaining).toBe(600);
    expect(voidedLine?.remaining).toBe(500);
    expect(rows.every((r) => r.overdue === false)).toBe(true);
  });

  it('filter tanggal mempersempit pemasukan', async () => {
    const past = await api()
      .get('/api/reports?type=summary&from=2020-01-01&to=2020-12-31')
      .set(auth(adminToken))
      .expect(200);
    expect(past.body.summary.income).toBe(0);
    // saldo saat ini tidak ikut nol: dipisah dari pemasukan periode
    expect(past.body.summary.outstanding).toBe(1100);
  });

  it('type dan tanggal tidak valid → 400', async () => {
    await api()
      .get('/api/reports?type=ngawur')
      .set(auth(adminToken))
      .expect(400);
    await api()
      .get('/api/reports?type=summary&from=25-10-2026')
      .set(auth(adminToken))
      .expect(400);
  });
});

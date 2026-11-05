import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { InvoicesRepository } from './../src/app/modules/invoices/invoices.repository.js';
import { FinanceEventsRepository } from './../src/app/modules/finance/finance-events.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';
import { createFakeInvoices, FakeInvoices } from './helpers/fake-invoices.js';

// CRUD tagihan diuji lewat HTTP dengan UsersRepository dan
// InvoicesRepository in-memory: tidak ada penulisan ke tabel produksi.
// Alur pembayaran/void diuji di payments.e2e-spec.ts.
describe('Invoices (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let fakeInvoices: FakeInvoices;
  let fakeFinanceEvents: { list: ReturnType<typeof vi.fn> };
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();
    fakeInvoices = createFakeInvoices();
    fakeFinanceEvents = {
      list: vi.fn().mockResolvedValue([
        {
          id: 1,
          entity_type: 'invoice',
          entity_id: 1,
          action: 'INVOICE_CREATED',
          before_json: null,
          after_json: { amount: 29700.5 },
          reason: null,
          actor_id: 2,
          actor_name: 'Operator Uji',
          ip_address: '127.0.0.1',
          created_at: new Date('2026-03-01T02:00:00Z'),
        },
      ]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(InvoicesRepository)
      .useValue(fakeInvoices.repo)
      // Riwayat aktivitas dibaca dari finance_events; di e2e cukup di-override
      // agar tidak menyentuh database. Penulisan event diuji di test unit
      // (invoices.repository.spec.ts / payments-audit.spec.ts).
      .overrideProvider(FinanceEventsRepository)
      .useValue(fakeFinanceEvents)
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

    // Fase 1: reseller boleh membaca; filter pemilik diterapkan di SQL
    // (dibuktikan pada test/reseller-isolation.int-spec.ts).
    it('resseler boleh membaca tagihan (cakupan diuji di tes integrasi)', async () => {
      await api().get('/api/invoices').set(auth(resellerToken)).expect(200);
      await api().get('/api/invoices/summary').set(auth(resellerToken)).expect(200);
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

    it('hapus permanen oleh admin → 200 dan tagihan hilang', async () => {
      await api().delete(`/api/invoices/${id}`).set(auth(adminToken)).expect(200);
      await api().get(`/api/invoices/${id}`).set(auth(adminToken)).expect(404);
    });
  });

  describe('periode tagihan', () => {
    let id: number;

    it('membuat tagihan dengan periode → 201 dan periode tersimpan', async () => {
      const res = await api()
        .post('/api/invoices')
        .set(auth(operatorToken))
        .send({ ...validPayload, period_start: '2026-03-01', period_end: '2026-03-31' })
        .expect(201);
      expect(res.body.period_start).toBe('2026-03-01');
      expect(res.body.period_end).toBe('2026-03-31');
      id = res.body.id;
    });

    it('mengubah periode lewat PATCH → 200', async () => {
      const res = await api()
        .patch(`/api/invoices/${id}`)
        .set(auth(operatorToken))
        .send({ period_start: '2026-04-01', period_end: '2026-04-30' })
        .expect(200);
      expect(res.body.period_start).toBe('2026-04-01');
      expect(res.body.period_end).toBe('2026-04-30');
    });

    it('periode hanya satu ujung ditolak → 400', async () => {
      await api()
        .post('/api/invoices')
        .set(auth(adminToken))
        .send({ ...validPayload, period_start: '2026-03-01' })
        .expect(400);
    });

    it('periode akhir sebelum awal ditolak → 400', async () => {
      const res = await api()
        .post('/api/invoices')
        .set(auth(adminToken))
        .send({ ...validPayload, period_start: '2026-03-31', period_end: '2026-03-01' })
        .expect(400);
      expect(res.body.message).toMatch(/periode akhir/i);
    });

    it('periode bukan format YYYY-MM-DD ditolak → 400', async () => {
      await api()
        .post('/api/invoices')
        .set(auth(adminToken))
        .send({ ...validPayload, period_start: '2026-03-01T00:00:00Z', period_end: '2026-03-31' })
        .expect(400);
    });
  });

  describe('pembatalan tagihan (void)', () => {
    let id: number;

    beforeAll(async () => {
      const res = await api()
        .post('/api/invoices')
        .set(auth(adminToken))
        .send({ ...validPayload, period_start: '2026-05-01', period_end: '2026-05-31' })
        .expect(201);
      id = res.body.id;
    });

    it('alasan wajib: tanpa alasan → 400', async () => {
      await api().post(`/api/invoices/${id}/void`).set(auth(adminToken)).send({}).expect(400);
      await api()
        .post(`/api/invoices/${id}/void`)
        .set(auth(adminToken))
        .send({ reason: '   ' })
        .expect(400);
    });

    it('resseler tidak boleh membatalkan tagihan → 403', async () => {
      await api()
        .post(`/api/invoices/${id}/void`)
        .set(auth(resellerToken))
        .send({ reason: 'coba batalkan' })
        .expect(403);
    });

    it('operator membatalkan dengan alasan → 200, status void, periode tetap', async () => {
      const res = await api()
        .post(`/api/invoices/${id}/void`)
        .set(auth(operatorToken))
        .send({ reason: 'salah input periode' })
        .expect(200);

      expect(res.body.status).toBe('void');
      expect(res.body.void_reason).toBe('salah input periode');
      expect(res.body.period_start).toBe('2026-05-01');
      expect(res.body.period_end).toBe('2026-05-31');
    });

    it('tagihan void tidak bisa diedit → 409', async () => {
      await api()
        .patch(`/api/invoices/${id}`)
        .set(auth(adminToken))
        .send({ amount: 1000 })
        .expect(409);
    });

    it('void kedua ditolak → 409', async () => {
      await api()
        .post(`/api/invoices/${id}/void`)
        .set(auth(adminToken))
        .send({ reason: 'ulangi void' })
        .expect(409);
    });

    it('tagihan void tetap bisa dihapus permanen oleh admin → 200', async () => {
      const detail = await api().get(`/api/invoices/${id}`).set(auth(adminToken)).expect(200);
      expect(detail.body.status).toBe('void');
      await api().delete(`/api/invoices/${id}`).set(auth(adminToken)).expect(200);
    });

    it('riwayat aktivitas tagihan memuat event audit → 200', async () => {
      const res = await api().get(`/api/invoices/${id}/events`).set(auth(adminToken)).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatchObject({ entity_type: 'invoice', action: 'INVOICE_CREATED' });
    });

    it('riwayat tagihan yang tidak ada → 404', async () => {
      await api().get('/api/invoices/999999/events').set(auth(adminToken)).expect(404);
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

  describe('ID tidak ditemukan', () => {
    it('get / patch → 404', async () => {
      await api().get('/api/invoices/999999').set(auth(adminToken)).expect(404);
      await api().patch('/api/invoices/999999').set(auth(adminToken)).send({ amount: 10 }).expect(404);
    });

    // DELETE fisik kini tersedia (opsi B): tagihan yang tidak ada → 404.
    it('delete tagihan tidak ada → 404', async () => {
      await api().delete('/api/invoices/999999').set(auth(adminToken)).expect(404);
    });
  });
});
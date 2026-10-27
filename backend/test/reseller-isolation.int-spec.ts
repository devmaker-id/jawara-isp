import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { assertSafeTestDatabase } from './helpers/test-db-guard';

// =====================================================================
// TES INTEGRASI ISOLASI RESELLER — WAJIB DATABASE SEKALI-PAKAI
//
// Menjalankan: DB_NAME=isp_reseller_it DB_PORT=3399 npx vitest run \
//   --config ./vitest.config.integration.ts
//
// Guard di bawah menolak jalan bila konfigurasi menunjuk produksi
// (isp_billing / nama tanpa penanda test). Tes ini menulis data, jadi
// hanya boleh pada instance MariaDB disposable yang sudah menjalankan
// schema + migrasi 001, 002, dan 003.
// =====================================================================
const target = assertSafeTestDatabase('write');

/* eslint-disable @typescript-eslint/no-explicit-any */
// mysql2 dipakai apa adanya untuk seeding; koneksi aplikasi tetap lewat
// DatabaseService milik aplikasi (env sudah menunjuk database uji).
import mysql from 'mysql2/promise';

const USERS = {
  admin: 101,
  operator: 102,
  r1: 201,
  r2: 202,
  inactive: 203,
};

const CUSTOMERS = { c1: 301, c2: 302, unowned: 303, inactiveOwner: 304 };
const INVOICES = { i1: 401, i2: 402, i3: 403, i4: 404 };

describe('Isolasi reseller (integrasi, DB sekali-pakai)', () => {
  let app: INestApplication<App>;
  let db: mysql.Connection;
  let tokens: Record<keyof typeof USERS, string>;
  let moduleFixture: TestingModule;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, role: keyof typeof USERS) =>
    req.set('Authorization', `Bearer ${tokens[role]}`);

  beforeAll(async () => {
    db = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: process.env.DB_USER ?? 'root',
      password: process.env.DB_PASSWORD ?? '',
      database: target.name,
    });

    // Kolom hasil migrasi 003 harus ada; kalau tidak, tes ini tidak bermakna.
    const [columnRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'owner_id'`,
      [target.name],
    );
    if (columnRows.length === 0) {
      throw new Error(
        'Kolom customers.owner_id tidak ada di database uji. Jalankan 003_customer_reseller_ownership.sql pada database disposable lebih dulu.',
      );
    }
    const [paymentRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'payments'`,
      [target.name],
    );
    if (paymentRows.length === 0) {
      throw new Error('Tabel payments tidak ada di database uji. Jalankan 001_payments.sql lebih dulu.');
    }

    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['payments', 'audit_logs', 'invoices', 'service_sessions', 'customers', 'users']) {
      await db.query(`TRUNCATE TABLE ${table}`);
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES
        (?, 'Admin Uji', 'admin@uji.test', 'x', 'admin', 1),
        (?, 'Operator Uji', 'operator@uji.test', 'x', 'operator', 1),
        (?, 'Reseller Satu', 'r1@uji.test', 'x', 'resseler', 1),
        (?, 'Reseller Dua', 'r2@uji.test', 'x', 'resseler', 1),
        (?, 'Reseller Nonaktif', 'r3@uji.test', 'x', 'resseler', 0)`,
      [USERS.admin, USERS.operator, USERS.r1, USERS.r2, USERS.inactive],
    );

    await db.query(
      `INSERT INTO customers (id, name, email, phone, address, is_active, owner_id) VALUES
        (?, 'Pelanggan R1', 'c1@uji.test', '0811', '', 1, ?),
        (?, 'Pelanggan R2', 'c2@uji.test', '0812', '', 1, ?),
        (?, 'Pelanggan Tanpa Pemilik', 'c3@uji.test', '0813', '', 1, NULL),
        (?, 'Pelanggan Reseller Nonaktif', 'c4@uji.test', '0814', '', 1, ?)`,
      [CUSTOMERS.c1, USERS.r1, CUSTOMERS.c2, USERS.r2, CUSTOMERS.unowned, CUSTOMERS.inactiveOwner, USERS.inactive],
    );

    await db.query(
      `INSERT INTO invoices (id, invoice_number, customer_id, customer_name, amount, status, due_date, description) VALUES
        (?, 'INV-401', ?, 'Pelanggan R1', 150.00, 'unpaid', '2026-10-01', 'uji'),
        (?, 'INV-402', ?, 'Pelanggan R2', 200.00, 'paid', '2026-10-01', 'uji'),
        (?, 'INV-403', ?, 'Pelanggan Tanpa Pemilik', 50.00, 'paid', '2026-10-01', 'uji'),
        (?, 'INV-404', ?, 'Pelanggan Reseller Nonaktif', 80.00, 'paid', '2026-10-01', 'uji')`,
      [
        INVOICES.i1, CUSTOMERS.c1,
        INVOICES.i2, CUSTOMERS.c2,
        INVOICES.i3, CUSTOMERS.unowned,
        INVOICES.i4, CUSTOMERS.inactiveOwner,
      ],
    );

    await db.query(
      `INSERT INTO payments (id, invoice_id, amount, method, paid_at, recorded_by, note, voided_at, voided_by, void_reason) VALUES
        (501, ?, 100.00, 'cash', '2026-10-02 10:00:00', ?, 'valid r1', NULL, NULL, NULL),
        (502, ?, 200.00, 'transfer', '2026-10-02 11:00:00', ?, 'valid r2', NULL, NULL, NULL),
        (503, ?, 50.00, 'qris', '2026-10-02 12:00:00', ?, 'valid unowned', NULL, NULL, NULL),
        (504, ?, 25.00, 'cash', '2026-10-03 09:00:00', ?, 'dibatalkan', '2026-10-03 10:00:00', ?, 'salah catat'),
        (505, ?, 80.00, 'cash', '2026-10-02 13:00:00', ?, 'valid r3', NULL, NULL, NULL)`,
      [
        INVOICES.i1, USERS.r1,
        INVOICES.i2, USERS.r2,
        INVOICES.i3, USERS.operator,
        INVOICES.i1, USERS.r1, USERS.admin,
        INVOICES.i4, USERS.inactive,
      ],
    );

    await db.query(
      `INSERT INTO service_sessions (id, customer_id, service_type, status, username, expires_at) VALUES
        (601, ?, 'pppoe', 'active', 'r1-user', '2027-01-01 00:00:00'),
        (602, ?, 'hotspot', 'active', 'r2-user', '2027-01-01 00:00:00'),
        (603, ?, 'pppoe', 'active', 'unowned-user', '2027-01-01 00:00:00')`,
      [CUSTOMERS.c1, CUSTOMERS.c2, CUSTOMERS.unowned],
    );

    const { AppModule } = await import('../src/app.module.js');
    const { ConfigService } = await import('../src/app/config/config.service.js');
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const secret = app.get(ConfigService).jwtSecret;
    const jwt = new JwtService();
    const sign = (id: number, email: string, role: string) =>
      jwt.sign({ sub: id, email, role }, { secret, expiresIn: '1h' });
    tokens = {
      admin: sign(USERS.admin, 'admin@uji.test', 'admin'),
      operator: sign(USERS.operator, 'operator@uji.test', 'operator'),
      r1: sign(USERS.r1, 'r1@uji.test', 'resseler'),
      r2: sign(USERS.r2, 'r2@uji.test', 'resseler'),
      inactive: sign(USERS.inactive, 'r3@uji.test', 'resseler'),
    };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  describe('cakupan pelanggan', () => {
    it('reseller hanya melihat pelanggannya sendiri (total ikut terfilter)', async () => {
      const res = await auth(http().get('/api/customers?page=1&limit=50'), 'r1').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows.map((row: { id: number }) => row.id)).toEqual([CUSTOMERS.c1]);
    });

    it('reseller tidak melihat pelanggan tanpa pemilik', async () => {
      const res = await auth(http().get('/api/customers?page=1&limit=50'), 'r1').expect(200);
      expect(res.body.rows.some((row: { id: number }) => row.id === CUSTOMERS.unowned)).toBe(false);
      await auth(http().get(`/api/customers/${CUSTOMERS.unowned}`), 'r1').expect(404);
    });

    it('detail pelanggan reseller lain → 404 generik', async () => {
      const res = await auth(http().get(`/api/customers/${CUSTOMERS.c2}`), 'r1').expect(404);
      expect(String(res.body.message)).toMatch(/tidak ditemukan/i);
    });

    it('reseller dapat membaca pelanggannya sendiri', async () => {
      const res = await auth(http().get(`/api/customers/${CUSTOMERS.c1}`), 'r1').expect(200);
      expect(res.body.id).toBe(CUSTOMERS.c1);
    });

    it('admin dan operator melihat seluruh pelanggan termasuk tanpa pemilik', async () => {
      for (const role of ['admin', 'operator'] as const) {
        const res = await auth(http().get('/api/customers?page=1&limit=50'), role).expect(200);
        expect(res.body.total).toBe(4);
        expect(res.body.rows.some((row: { id: number }) => row.id === CUSTOMERS.unowned)).toBe(true);
      }
    });

    it('pencarian reseller tidak menemukan pelanggan reseller lain', async () => {
      const res = await auth(http().get('/api/customers?page=1&search=Pelanggan%20R2'), 'r1').expect(200);
      expect(res.body.total).toBe(0);
    });

    it('owner_id dari query tidak dipakai sebagai dasar otorisasi', async () => {
      const res = await auth(
        http().get(`/api/customers?page=1&limit=50&owner_id=${USERS.r2}`),
        'r1',
      );
      // DTO menolak field asing (400) — bukan mengalihkan cakupan ke r2.
      expect([400, 200]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.rows.map((row: { id: number }) => row.id)).toEqual([CUSTOMERS.c1]);
      }
    });
  });

  describe('cakupan tagihan, layanan, dan pembayaran', () => {
    it('daftar tagihan hanya milik reseller', async () => {
      const res = await auth(http().get('/api/invoices?page=1&limit=50'), 'r1').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].invoice_number).toBe('INV-401');
    });

    it('detail tagihan reseller lain → 404', async () => {
      await auth(http().get(`/api/invoices/${INVOICES.i2}`), 'r1').expect(404);
      await auth(http().get(`/api/invoices/${INVOICES.i3}`), 'r1').expect(404);
    });

    it('ringkasan tagihan hanya menghitung tagihan sendiri', async () => {
      const res = await auth(http().get('/api/invoices/summary'), 'r1').expect(200);
      expect(res.body.total).toBe(150);
    });

    it('daftar layanan hanya milik pelanggan reseller', async () => {
      const res = await auth(http().get('/api/services?page=1&limit=50'), 'r1').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].username).toBe('r1-user');
      await auth(http().get('/api/services/602'), 'r1').expect(404);
    });

    it('riwayat pembayaran hanya pembayaran pada tagihan sendiri', async () => {
      const res = await auth(http().get('/api/payments?page=1&limit=50'), 'r1').expect(200);
      expect(res.body.total).toBe(2); // satu valid + satu void, keduanya di INV-401
      expect(res.body.rows.every((row: { invoice_id: number }) => row.invoice_id === INVOICES.i1)).toBe(true);
    });

    it('pencarian pembayaran tagihan reseller lain tidak membocorkan baris', async () => {
      const res = await auth(http().get('/api/payments?page=1&limit=50&search=INV-402'), 'r1').expect(200);
      expect(res.body.total).toBe(0);
      expect(res.body.rows).toEqual([]);
    });

    it('parameter asing (invoice_id) ditolak DTO, bukan dipakai sebagai filter', async () => {
      await auth(
        http().get(`/api/payments?page=1&limit=50&invoice_id=${INVOICES.i2}`),
        'r1',
      ).expect(400);
    });

    it('ringkasan pembayaran: pemasukan hanya milik sendiri dan void tidak dihitung', async () => {
      const res = await auth(http().get('/api/payments/summary'), 'r1').expect(200);
      expect(res.body.income).toBe(100); // 25 void tidak dihitung
      expect(res.body.transactions).toBe(1);
      expect(res.body.outstanding).toBe(50); // 150 - 100 valid
    });

    it('ringkasan admin memuat seluruh pembayaran sah, void tetap dikecualikan', async () => {
      const res = await auth(http().get('/api/payments/summary'), 'admin').expect(200);
      expect(res.body.income).toBe(430);
      expect(res.body.transactions).toBe(4);
    });

    it('pilihan tagihan yang masih bersisa juga ter-scope', async () => {
      const res = await auth(http().get('/api/payments/payable-invoices?page=1&limit=20'), 'r1').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].id).toBe(INVOICES.i1);
    });

    it('pembayaran per tagihan reseller lain tidak dikembalikan', async () => {
      const res = await auth(http().get(`/api/invoices/${INVOICES.i2}/payments`), 'r1').expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('laporan dan CSV', () => {
    it('laporan transaksi reseller hanya barisnya sendiri', async () => {
      const res = await auth(http().get('/api/reports?type=transactions&limit=50'), 'r1').expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.rows.every((row: { invoice_id: number }) => row.invoice_id === INVOICES.i1)).toBe(true);
    });

    it('laporan ringkasan reseller tidak memuat angka global', async () => {
      const res = await auth(http().get('/api/reports?type=summary'), 'r1').expect(200);
      expect(res.body.summary.income).toBe(100);
      expect(res.body.summary.outstanding).toBe(50);
    });

    it('laporan per metode hanya metode milik sendiri', async () => {
      const res = await auth(http().get('/api/reports?type=by-method'), 'r1').expect(200);
      expect(res.body.by_method).toEqual([{ method: 'cash', transactions: 1, total: 100 }]);
    });

    it('laporan tagihan belum lunas tidak memuat tagihan reseller lain', async () => {
      const res = await auth(http().get('/api/reports?type=unpaid&limit=50'), 'r1').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].id).toBe(INVOICES.i1);
    });

    it('ekspor CSV tagihan hanya memuat baris reseller', async () => {
      const res = await auth(http().get('/api/exports/invoices'), 'r1').expect(200);
      expect(String(res.headers['content-type'])).toMatch(/text\/csv/);
      expect(res.text).toContain('INV-401');
      expect(res.text).not.toContain('INV-402');
      expect(res.text).not.toContain('INV-403');
      expect(res.headers['x-export-rows']).toBe('1');
    });

    it('ekspor CSV admin memuat seluruh tagihan', async () => {
      const res = await auth(http().get('/api/exports/invoices'), 'admin').expect(200);
      expect(res.headers['x-export-rows']).toBe('4');
      expect(res.text).toContain('INV-402');
    });

    it('ekspor CSV pembayaran reseller tidak memuat pembayaran reseller lain', async () => {
      const res = await auth(http().get('/api/exports/payments'), 'r1').expect(200);
      expect(res.text).toContain('valid r1');
      expect(res.text).not.toContain('valid r2');
      expect(res.headers['x-export-rows']).toBe('2');
    });

    it('jenis ekspor tidak dikenal → 404', async () => {
      await auth(http().get('/api/exports/ngawur'), 'admin').expect(404);
    });
  });

  describe('mutasi dan akun nonaktif', () => {
    it('reseller tidak boleh mengubah kepemilikan pelanggan', async () => {
      await auth(http().patch(`/api/customers/${CUSTOMERS.c1}/owner`), 'r1')
        .send({ owner_id: USERS.r2 })
        .expect(403);
    });

    it('reseller tidak boleh membuat pelanggan, tagihan, atau pembayaran', async () => {
      await auth(http().post('/api/customers'), 'r1')
        .send({ name: 'Baru', email: 'baru@uji.test', phone: '081234567' })
        .expect(403);
      await auth(http().post('/api/invoices'), 'r1').send({}).expect(403);
      await auth(http().post('/api/payments'), 'r1').send({}).expect(403);
      await auth(http().post(`/api/invoices/${INVOICES.i1}/payments`), 'r1').send({}).expect(403);
    });

    it('reseller tidak boleh void pembayaran', async () => {
      await auth(http().post('/api/payments/502/void'), 'r1').send({ reason: 'coba' }).expect(403);
    });

    it('akun reseller nonaktif ditolak walau tokennya masih sah (401)', async () => {
      const res = await auth(http().get('/api/customers?page=1&limit=10'), 'inactive').expect(401);
      expect(String(res.body.message)).toMatch(/tidak aktif/i);
    });

    it('pelanggan milik reseller nonaktif tetap tercatat sebagai pemiliknya', async () => {
      const [rows] = await db.query<mysql.RowDataPacket[]>(
        'SELECT owner_id FROM customers WHERE id = ?',
        [CUSTOMERS.inactiveOwner],
      );
      expect(rows[0].owner_id).toBe(USERS.inactive);
    });
  });

  describe('pagination dan hitungan', () => {
    it('limit kecil tidak menaikkan total di luar cakupan', async () => {
      const res = await auth(http().get('/api/customers?page=1&limit=1'), 'r1').expect(200);
      expect(res.body.rows.length).toBe(1);
      expect(res.body.total).toBe(1);
    });

    it('halaman kedua reseller kosong, bukan berisi data reseller lain', async () => {
      const res = await auth(http().get('/api/customers?page=2&limit=1'), 'r1').expect(200);
      expect(res.body.rows).toEqual([]);
      expect(res.body.total).toBe(1);
    });

    it('reseller tidak bisa mengakses endpoint admin', async () => {
      await auth(http().get('/api/admin/users?page=1&limit=10'), 'r1').expect(403);
      await auth(http().get('/api/settings'), 'r1').expect(403);
    });
  });
});
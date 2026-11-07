import { describe, expect, it, vi } from 'vitest';
import {
  InvoicesRepository,
  InvoiceActor,
  InvoiceError,
} from '../src/app/modules/invoices/invoices.repository';
import { InvoiceStatus } from '../src/app/modules/invoices/dto/invoice.dto';
import type { DatabaseService } from '../src/app/database/database.service';

// Semua test memakai mock DatabaseService: tidak ada koneksi ke database.
type Opts = { rows?: unknown[]; one?: unknown; execute?: unknown };

function makeDb({ rows = [], one = null, execute = { insertId: 0, affectedRows: 0 } }: Opts = {}) {
  const conn = { query: vi.fn().mockResolvedValue([rows, []]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  const db = {
    query: vi.fn().mockResolvedValue(rows),
    queryOne: vi.fn().mockResolvedValue(one),
    execute: vi.fn().mockResolvedValue(execute),
    withTransaction: vi.fn(async (work: (c: unknown) => Promise<unknown>) => work(conn)),
  };
  return { db: db as unknown as DatabaseService, raw: db, conn };
}

const actor: InvoiceActor = {
  id: 7,
  email: 'operator@uji.test',
  name: 'Operator Uji',
  ip: '127.0.0.1',
};

// Baris hasil SELECT, termasuk kolom migrasi 032.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  invoice_number: 'INV-2026-0001',
  customer_id: 3,
  username: null,
  customer_name: 'Pelanggan Uji',
  amount: '49500.50',
  status: 'unpaid',
  due_date: '2026-02-01',
  period_start: null,
  period_end: null,
  paid_date: null,
  description: 'bulanan',
  voided_at: null,
  void_reason: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

interface QueryLog {
  sql: string;
  params: unknown[];
}

/**
 * Connection palsu yang menjawab berdasarkan potongan SQL dan meniru
 * DatabaseService.withTransaction (begin → work → commit, atau rollback saat
 * work melempar). Dipakai untuk membuktikan event audit berada di transaksi
 * yang sama dan kegagalannya membatalkan perubahan bisnis.
 */
function scriptedDb(respond: (sql: string) => unknown[] | Promise<unknown[]>) {
  const log: QueryLog[] = [];
  const conn = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [await respond(sql), []];
    }),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
  };
  const db = {
    withTransaction: async (work: (c: unknown) => Promise<unknown>) => {
      await conn.beginTransaction();
      try {
        const result = await work(conn);
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },
  } as unknown as DatabaseService;
  return { db, conn, log };
}

const auditInserts = (log: QueryLog[]) => log.filter((q) => q.sql.startsWith('INSERT INTO finance_events'));

describe('InvoicesRepository', () => {
  it('memetakan amount DECIMAL string menjadi number dan tanggal menjadi YYYY-MM-DD', async () => {
    const { db } = makeDb({ rows: [row({ due_date: new Date(2026, 1, 1) })] });
    const [inv] = await new InvoicesRepository(db).findAll();

    expect(typeof inv.amount).toBe('number');
    expect(inv.amount).toBe(49500.5);
    expect(inv.amount.toFixed(2)).toBe('49500.50');
    expect(inv.due_date).toBe('2026-02-01');
    expect(inv.paid_date).toBeNull();
    expect(inv.period_start).toBeNull();
    expect(inv.period_end).toBeNull();
  });

  it('memetakan periode dan jejak void dari database', async () => {
    const voidedAt = new Date('2026-03-05T02:00:00Z');
    const { db } = makeDb({
      rows: [
        row({
          status: 'void',
          period_start: new Date(2026, 2, 1),
          period_end: '2026-03-31',
          voided_at: voidedAt,
          void_reason: 'salah periode',
        }),
      ],
    });
    const [inv] = await new InvoicesRepository(db).findAll();

    expect(inv.period_start).toBe('2026-03-01');
    expect(inv.period_end).toBe('2026-03-31');
    expect(inv.status).toBe(InvoiceStatus.VOID);
    expect(inv.void_reason).toBe('salah periode');
    expect(inv.voided_at).toEqual(voidedAt);
  });

  it('meneruskan status turunan (overdue) dari query', async () => {
    const { db } = makeDb({ rows: [row({ status: 'overdue' })] });
    const [inv] = await new InvoicesRepository(db).findAll();
    expect(inv.status).toBe('overdue');
  });

  it('findAll memakai query parameterized tanpa menyisipkan nilai', async () => {
    const { db, raw } = makeDb({ rows: [] });
    await new InvoicesRepository(db).findAll();
    const [sql, params] = raw.query.mock.calls[0];
    expect(sql).toContain('FROM invoices');
    expect(params ?? []).toEqual([]);
  });

  it('summary mengubah hasil agregat menjadi number', async () => {
    const { db } = makeDb({ one: { total: '1234.50', paid: '2', unpaid: '1', overdue: 3 } });
    const summary = await new InvoicesRepository(db).summary();
    expect(summary).toEqual({ total: 1234.5, paid: 2, unpaid: 1, overdue: 3 });
  });

  it('summary mengembalikan nol saat tabel kosong', async () => {
    const { db } = makeDb({ one: { total: null, paid: null, unpaid: null, overdue: null } });
    await expect(new InvoicesRepository(db).summary()).resolves.toEqual({
      total: 0,
      paid: 0,
      unpaid: 0,
      overdue: 0,
    });
  });

  it('summary mengeluarkan tagihan void dari total', async () => {
    const { db, raw } = makeDb({ one: { total: 0, paid: 0, unpaid: 0, overdue: 0 } });
    await new InvoicesRepository(db).summary();
    const [sql] = raw.queryOne.mock.calls[0];
    expect(sql).toMatch(/s <> 'void'/);
  });

  describe('create', () => {
    it('mengambil nama pelanggan, membuat nomor urut, lalu insert parameterized', async () => {
      const created = row({ id: 9, invoice_number: 'INV-2026-0005' });
      const { db, log } = scriptedDb((sql) => {
        if (sql.startsWith('INSERT INTO invoices')) return [{ insertId: 9, affectedRows: 1 }];
        if (sql.includes('FROM customers')) return [{ name: 'Pelanggan Uji' }];
        if (sql.includes('invoice_number REGEXP')) return [{ invoice_number: 'INV-2026-0004' }];
        if (sql.includes('FROM invoices WHERE id = ?')) return [created];
        return [];
      });

      const created9 = await new InvoicesRepository(db).create(
        { customer_id: 3, amount: 29700.25, due_date: '2026-03-01', description: 'Maret' },
        actor,
      );

      expect(created9.id).toBe(9);
      const insert = log.find((q) => q.sql.startsWith('INSERT INTO invoices'));
      expect(insert?.sql).toContain('period_start, period_end');
      expect(insert?.params).toEqual([
        'INV-2026-0005',
        3,
        // username: tagihan tanpa akun RADIUS (migrasi 014).
        null,
        'Pelanggan Uji',
        29700.25,
        'unpaid',
        '2026-03-01',
        // periode kosong: tagihan non-layanan tetap sah.
        null,
        null,
        'Maret',
      ]);
    });

    it('menyimpan periode dan menulis event INVOICE_CREATED di transaksi yang sama', async () => {
      const created = row({
        id: 9,
        invoice_number: 'INV-2026-0005',
        username: 'budi-ppp',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
      });
      const { db, conn, log } = scriptedDb((sql) => {
        if (sql.startsWith('INSERT INTO invoices')) return [{ insertId: 9, affectedRows: 1 }];
        if (sql.includes('FROM customers')) return [{ name: 'Pelanggan Uji' }];
        if (sql.includes('invoice_number REGEXP')) return [];
        if (sql.includes('FROM invoices WHERE id = ?')) return [created];
        return [];
      });

      await new InvoicesRepository(db).create(
        {
          customer_id: 3,
          username: 'budi-ppp',
          amount: 100000,
          due_date: '2026-03-10',
          period_start: '2026-03-01',
          period_end: '2026-03-31',
        },
        actor,
      );

      const [event] = auditInserts(log);
      expect(event).toBeDefined();
      expect(event.params.slice(0, 3)).toEqual(['invoice', 9, 'INVOICE_CREATED']);
      expect(event.params[3]).toBeNull(); // before_json: create tidak punya nilai lama
      const after = JSON.parse(String(event.params[4]));
      expect(after).toMatchObject({ period_start: '2026-03-01', period_end: '2026-03-31' });
      // Pelaku dan IP tersimpan sebagai snapshot untuk penelusuran.
      expect(event.params.slice(6, 9)).toEqual([actor.id, actor.name, actor.ip]);

      // Insert tagihan dan insert audit memakai connection transaksi yang sama.
      const invoiceAt = log.findIndex((q) => q.sql.startsWith('INSERT INTO invoices'));
      const auditAt = log.findIndex((q) => q.sql.startsWith('INSERT INTO finance_events'));
      expect(auditAt).toBeGreaterThan(invoiceAt);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(conn.rollback).not.toHaveBeenCalled();
    });

    it('membatalkan transaksi (rollback) bila event audit gagal ditulis', async () => {
      const { db, conn } = scriptedDb((sql) => {
        if (sql.startsWith('INSERT INTO invoices')) return [{ insertId: 9, affectedRows: 1 }];
        if (sql.includes('FROM customers')) return [{ name: 'Pelanggan Uji' }];
        if (sql.includes('invoice_number REGEXP')) return [];
        if (sql.includes('FROM invoices WHERE id = ?')) return [row({ id: 9 })];
        if (sql.startsWith('INSERT INTO finance_events')) {
          throw Object.assign(new Error('Unknown table finance_events'), { code: 'ER_NO_SUCH_TABLE' });
        }
        return [];
      });

      await expect(
        new InvoicesRepository(db).create(
          { customer_id: 3, amount: 1000, due_date: '2026-03-01' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'ER_NO_SUCH_TABLE' });

      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
    });

    it('melempar CUSTOMER_NOT_FOUND bila pelanggan tidak ada', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[], []]) };
      const db = {
        withTransaction: async (work: (c: unknown) => Promise<unknown>) => work(conn),
      } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).create(
          { customer_id: 999, amount: 1000, due_date: '2026-03-01' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
    });

    it('menolak periode yang hanya diisi salah satu ujung, tanpa menyentuh database', async () => {
      const { db, raw } = makeDb();

      await expect(
        new InvoicesRepository(db).create(
          {
            customer_id: 3,
            amount: 1000,
            due_date: '2026-03-01',
            period_start: '2026-03-01',
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });

      expect(raw.withTransaction).not.toHaveBeenCalled();
    });

    it('menolak periode akhir sebelum periode awal', async () => {
      const { db } = makeDb();

      await expect(
        new InvoicesRepository(db).create(
          {
            customer_id: 3,
            amount: 1000,
            due_date: '2026-03-01',
            period_start: '2026-03-31',
            period_end: '2026-03-01',
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    });
  });

  describe('update', () => {
    it('menolak perubahan nominal pada tagihan lunas', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[row({ status: 'paid' })], []]) };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(new InvoicesRepository(db).update(1, { amount: 10 }, actor)).rejects.toMatchObject({
        code: 'PAID_INVOICE_LOCKED',
      });
    });

    it('menolak status paid lewat PATCH', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[row()], []]) };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).update(1, { status: 'paid' as never }, actor),
      ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });

    it('menolak status void lewat PATCH (harus lewat endpoint void)', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[row()], []]) };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).update(1, { status: 'void' as never }, actor),
      ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });

    it('menolak pengeditan tagihan yang sudah void', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[row({ status: 'void' })], []]) };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).update(1, { description: 'ubah' }, actor),
      ).rejects.toMatchObject({ code: 'INVOICE_ALREADY_VOID' });
    });

    it('memvalidasi periode baru terhadap periode tersimpan', async () => {
      const conn = {
        query: vi
          .fn()
          .mockResolvedValue([[row({ period_start: '2026-03-01', period_end: '2026-03-31' })], []]),
      };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).update(1, { period_end: '2026-02-01' }, actor),
      ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    });

    it('mencatat INVOICE_UPDATED dengan nilai sebelum dan sesudah', async () => {
      const before = row({ amount: '1000.00', period_start: '2026-03-01', period_end: '2026-03-31' });
      const after = row({ amount: '2000.00', period_start: '2026-03-01', period_end: '2026-03-31' });
      const { db, log } = scriptedDb((sql) => {
        if (sql.includes('FOR UPDATE')) return [before];
        if (sql.startsWith('UPDATE invoices')) return [{ affectedRows: 1 }];
        if (sql.includes('FROM invoices WHERE id = ?')) return [after];
        return [];
      });

      await new InvoicesRepository(db).update(1, { amount: 2000 }, actor);

      const [event] = auditInserts(log);
      expect(event.params.slice(0, 3)).toEqual(['invoice', 1, 'INVOICE_UPDATED']);
      expect(JSON.parse(String(event.params[3]))).toMatchObject({ amount: 1000 });
      expect(JSON.parse(String(event.params[4]))).toMatchObject({ amount: 2000 });
    });
  });

  describe('void', () => {
    it('menandai status void, menyimpan alasan & pelaku, lalu menulis INVOICE_VOIDED', async () => {
      const before = row({ status: 'unpaid', period_start: '2026-03-01', period_end: '2026-03-31' });
      const after = row({
        status: 'void',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        void_reason: 'salah input periode',
      });
      const { db, conn, log } = scriptedDb((sql) => {
        if (sql.includes('FOR UPDATE')) return [before];
        if (sql.includes('COUNT(*) AS n FROM payments')) return [{ n: 0 }];
        if (sql.startsWith('UPDATE invoices')) return [{ affectedRows: 1 }];
        if (sql.includes('FROM invoices WHERE id = ?')) return [after];
        return [];
      });

      const voided = await new InvoicesRepository(db).void(1, '  salah input periode  ', actor);

      expect(voided.status).toBe(InvoiceStatus.VOID);
      const update = log.find((q) => q.sql.startsWith('UPDATE invoices'));
      expect(update?.sql).toContain('voided_by');
      // Alasan di-trim sebelum disimpan.
      expect(update?.params).toEqual([InvoiceStatus.VOID, actor.id, 'salah input periode', 1]);

      const [event] = auditInserts(log);
      expect(event.params[0]).toBe('invoice');
      expect(event.params[1]).toBe(1);
      expect(event.params[2]).toBe('INVOICE_VOIDED');
      expect(event.params[5]).toBe('salah input periode');
      expect(JSON.parse(String(event.params[3]))).toMatchObject({ status: 'unpaid' });
      expect(JSON.parse(String(event.params[4]))).toMatchObject({ status: 'void' });
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    it('menolak void bila masih ada pembayaran sah dan rollback', async () => {
      const { db, conn, log } = scriptedDb((sql) => {
        if (sql.includes('FOR UPDATE')) return [row()];
        if (sql.includes('COUNT(*) AS n FROM payments')) return [{ n: 2 }];
        return [];
      });

      await expect(new InvoicesRepository(db).void(1, 'ganti tagihan', actor)).rejects.toMatchObject({
        code: 'INVOICE_HAS_PAYMENTS',
      });
      expect(log.some((q) => q.sql.startsWith('UPDATE invoices'))).toBe(false);
      expect(auditInserts(log)).toHaveLength(0);
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
    });

    it('void kedua ditolak dengan pesan yang jelas', async () => {
      const { db } = scriptedDb((sql) => (sql.includes('FOR UPDATE') ? [row({ status: 'void' })] : []));

      await expect(new InvoicesRepository(db).void(1, 'ulang', actor)).rejects.toMatchObject({
        code: 'INVOICE_ALREADY_VOID',
        message: expect.stringContaining('sudah dibatalkan'),
      });
    });

    it('membatalkan transaksi bila event void gagal ditulis', async () => {
      const { db, conn } = scriptedDb((sql) => {
        if (sql.includes('FOR UPDATE')) return [row()];
        if (sql.includes('COUNT(*) AS n FROM payments')) return [{ n: 0 }];
        if (sql.startsWith('UPDATE invoices')) return [{ affectedRows: 1 }];
        if (sql.includes('FROM invoices WHERE id = ?')) return [row({ status: 'void' })];
        if (sql.startsWith('INSERT INTO finance_events')) throw new Error('disk penuh');
        return [];
      });

      await expect(new InvoicesRepository(db).void(1, 'ganti tagihan', actor)).rejects.toThrow('disk penuh');
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
    });
  });

  it('remove menghapus permanen tagihan beserta pembayarannya (opsi B)', async () => {
    const { db, log, conn } = scriptedDb((sql) => {
      if (sql.includes('FOR UPDATE')) return [row()];
      if (sql.includes('SELECT id FROM payments WHERE invoice_id')) return [{ id: 10 }, { id: 11 }];
      return [];
    });

    const result = await new InvoicesRepository(db).remove(1, actor);

    expect(result).toEqual({ ok: true });
    const sqls = log.map((q) => q.sql);
    expect(sqls.some((s) => s.includes("DELETE FROM finance_events WHERE entity_type = 'payment'"))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM payments WHERE invoice_id = ?'))).toBe(true);
    expect(sqls.some((s) => s.includes("DELETE FROM finance_events WHERE entity_type = 'invoice'"))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM invoices WHERE id = ?'))).toBe(true);
    expect(log.some((q) => q.sql.startsWith('INSERT INTO audit_logs'))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});
import { describe, expect, it, vi } from 'vitest';
import { InvoicesRepository } from '../src/app/modules/invoices/invoices.repository';
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

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  invoice_number: 'INV-2026-0001',
  customer_id: 3,
  customer_name: 'Pelanggan Uji',
  amount: '49500.50',
  status: 'unpaid',
  due_date: '2026-02-01',
  paid_date: null,
  description: 'bulanan',
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('InvoicesRepository', () => {
  it('memetakan amount DECIMAL string menjadi number dan tanggal menjadi YYYY-MM-DD', async () => {
    const { db } = makeDb({ rows: [row({ due_date: new Date(2026, 1, 1) })] });
    const [inv] = await new InvoicesRepository(db).findAll();

    expect(typeof inv.amount).toBe('number');
    expect(inv.amount).toBe(49500.5);
    expect(inv.amount.toFixed(2)).toBe('49500.50');
    expect(inv.due_date).toBe('2026-02-01');
    expect(inv.paid_date).toBeNull();
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

  describe('create', () => {
    it('mengambil nama pelanggan, membuat nomor urut, lalu insert parameterized', async () => {
      const insert = vi.fn().mockResolvedValue([{ insertId: 9, affectedRows: 1 }, []]);
      const queries = [
        [{ name: 'Pelanggan Uji' }], // SELECT customers
        [{ invoice_number: 'INV-2026-0004' }], // SELECT nomor terakhir
        [row({ id: 9, invoice_number: 'INV-2026-0005' })], // SELECT hasil
      ];
      const conn = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('INSERT')) return insert(sql, params);
          return [queries.shift() ?? [], []];
        }),
      };
      const db = {
        withTransaction: async (work: (c: unknown) => Promise<unknown>) => work(conn),
      } as unknown as DatabaseService;

      const created = await new InvoicesRepository(db).create({
        customer_id: 3,
        amount: 29700.25,
        due_date: '2026-03-01',
        description: 'Maret',
      });

      expect(created.id).toBe(9);
      const [insertSql, insertParams] = insert.mock.calls[0];
      expect(insertSql).toContain('INSERT INTO invoices');
      expect(insertParams).toEqual([
        'INV-2026-0005',
        3,
        // username: tagihan tanpa akun RADIUS (migrasi 014).
        null,
        'Pelanggan Uji',
        29700.25,
        'unpaid',
        '2026-03-01',
        'Maret',
      ]);
    });

    it('melempar CUSTOMER_NOT_FOUND bila pelanggan tidak ada', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[], []]) };
      const db = {
        withTransaction: async (work: (c: unknown) => Promise<unknown>) => work(conn),
      } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).create({ customer_id: 999, amount: 1000, due_date: '2026-03-01' }),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('menolak perubahan nominal pada tagihan lunas', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[row({ status: 'paid' })], []]) };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(new InvoicesRepository(db).update(1, { amount: 10 })).rejects.toMatchObject({
        code: 'PAID_INVOICE_LOCKED',
      });
    });

    it('menolak status paid lewat PATCH', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[row()], []]) };
      const db = { withTransaction: async (w: (c: unknown) => Promise<unknown>) => w(conn) } as unknown as DatabaseService;

      await expect(
        new InvoicesRepository(db).update(1, { status: 'paid' as never }),
      ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });
  });

  it('remove mengembalikan false saat affectedRows = 0', async () => {
    const { db } = makeDb({ execute: { insertId: 0, affectedRows: 0 } });
    await expect(new InvoicesRepository(db).remove(99)).resolves.toBe(false);
  });
});
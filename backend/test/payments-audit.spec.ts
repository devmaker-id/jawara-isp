import { describe, expect, it, vi } from 'vitest';
import { PaymentsRepository } from '../src/app/modules/payments/payments.repository';
import { PaymentMethod } from '../src/app/modules/payments/dto/payment.dto';
import type { DatabaseService } from '../src/app/database/database.service';

// Pembayaran diuji dengan connection palsu yang meniru
// DatabaseService.withTransaction: begin → kerja → commit, atau rollback saat
// kerja melempar. Tujuannya membuktikan dua hal yang mudah rusak diam-diam:
// tagihan void tidak bisa dibayar, dan event audit berada di transaksi yang sama.

const actor = { id: 2, email: 'operator@uji.test', name: 'Operator Uji', ip: '127.0.0.1' };

interface QueryLog {
  sql: string;
  params: unknown[];
}

const paymentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  invoice_id: 5,
  invoice_number: 'INV-2026-0005',
  customer_name: 'Pelanggan Uji',
  invoice_status: 'partial',
  amount: '600.00',
  method: 'cash',
  reference: null,
  paid_at: '2026-03-02 09:30:00',
  recorded_by: actor.id,
  recorded_by_name: actor.name,
  note: '',
  idempotency_key: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  created_at: new Date('2026-03-02T02:30:00Z'),
  ...overrides,
});

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

const financeInserts = (log: QueryLog[]) =>
  log.filter((q) => q.sql.startsWith('INSERT INTO finance_events'));

// Urutan query nyata pada PaymentsRepository.create, dijawab berdasarkan pola.
const createResponder = (invoiceStatus: string, failAudit = false) => (sql: string) => {
  if (sql.startsWith('INSERT INTO payments')) return [{ insertId: 11, affectedRows: 1 }];
  if (sql.startsWith('INSERT INTO finance_events')) {
    if (failAudit) throw new Error('finance_events tidak dapat ditulis');
    return [];
  }
  if (sql.includes('FROM invoices WHERE id = ? FOR UPDATE')) {
    return [{ id: 5, amount: '1000', status: invoiceStatus }];
  }
  if (sql.includes('AS total FROM payments')) return [{ total: '0' }];
  if (sql.startsWith('UPDATE invoices SET status')) return [{ affectedRows: 1 }];
  if (sql.includes('SELECT username FROM invoices')) return [{ username: null }];
  if (sql.includes('FROM payments p') && sql.includes('WHERE p.id = ?')) return [paymentRow()];
  if (sql.includes('SELECT id, status, paid_date FROM invoices')) {
    return [{ id: 5, status: 'partial', paid_date: null }];
  }
  return [];
};

describe('PaymentsRepository.create — perlindungan tagihan void', () => {
  it('menolak pembayaran pada tagihan void tanpa menulis baris pembayaran', async () => {
    const { db, conn, log } = scriptedDb(createResponder('void'));

    await expect(
      new PaymentsRepository(db).create(5, { amount: 100 }, actor),
    ).rejects.toMatchObject({ code: 'INVOICE_VOIDED' });

    expect(log.some((q) => q.sql.startsWith('INSERT INTO payments'))).toBe(false);
    expect(financeInserts(log)).toHaveLength(0);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe('PaymentsRepository.create — event audit', () => {
  it('menulis PAYMENT_CREATED di transaksi yang sama dengan INSERT pembayaran', async () => {
    const { db, conn, log } = scriptedDb(createResponder('unpaid'));

    const result = await new PaymentsRepository(db).create(
      5,
      { amount: 600, method: PaymentMethod.CASH, note: 'cicilan' },
      actor,
    );

    expect(result.created).toBe(true);
    const [event] = financeInserts(log);
    expect(event.params.slice(0, 3)).toEqual(['payment', 11, 'PAYMENT_CREATED']);
    expect(JSON.parse(String(event.params[4]))).toMatchObject({
      invoice_id: 5,
      amount: 600,
      method: 'cash',
    });
    expect(event.params.slice(6, 9)).toEqual([actor.id, actor.name, actor.ip]);

    const paymentAt = log.findIndex((q) => q.sql.startsWith('INSERT INTO payments'));
    const auditAt = log.findIndex((q) => q.sql.startsWith('INSERT INTO finance_events'));
    expect(auditAt).toBeGreaterThan(paymentAt);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it('membatalkan pembayaran bila event audit gagal ditulis', async () => {
    const { db, conn } = scriptedDb(createResponder('unpaid', true));

    await expect(
      new PaymentsRepository(db).create(5, { amount: 600 }, actor),
    ).rejects.toThrow('finance_events tidak dapat ditulis');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
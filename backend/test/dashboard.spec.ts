import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from '../src/app/modules/dashboard/dashboard.service';
import type { DatabaseService } from '../src/app/database/database.service';
import type { SalesService } from '../src/app/modules/sales/sales.service';
import type { ReceivablesRepository } from '../src/app/modules/receivables/receivables.repository';

// Dashboard adalah layar pertama admin: angka piutang dan daftar tagihan di
// sini harus benar arahannya. Bug yang pernah terjadi: tagihan yang sudah
// terlambat ikut dihitung sebagai "jatuh tempo ≤7 hari" karena DATEDIFF
// dibalik. Tes ini mengunci arah selisih tanggal tersebut.
const revenue = {
  today: '2026-11-03',
  month_start: '2026-11-01',
  today_revenue: 12500,
  today_payments: 12500,
  today_vouchers: 0,
  today_voucher_cost: 0,
  today_margin: 0,
  month_revenue: 12500,
  month_payments: 12500,
  month_vouchers: 0,
  month_voucher_cost: 0,
  month_margin: 0,
  scope: 'all' as const,
};

function makeService() {
  const sql: string[] = [];
  const db = {
    queryOne: vi.fn(async (statement: string) => {
      sql.push(statement);
      if (statement.includes('FROM customers')) {
        return { total: 6, active: 5, expired: 1, suspend: 0, disable: 0 };
      }
      if (statement.includes('overdue_count')) {
        return { overdue_count: 2, overdue_total: 50000, due_soon_count: 0, due_soon_total: 0 };
      }
      if (statement.includes('active_packages')) return null;
      if (statement.includes('FROM olt_onus')) return { total: 129, missing: 3 };
      if (statement.includes('radacct')) return null;
      return null;
    }),
    query: vi.fn(async (statement: string) => {
      sql.push(statement);
      if (statement.includes('days_late')) {
        return [
          {
            id: 4,
            invoice_number: 'INV-2026-0001',
            customer_name: 'Pelanggan Uji',
            balance: '15000.00',
            due_date: '2026-10-09',
            days_late: 25,
          },
        ];
      }
      if (statement.includes('FROM payments p')) {
        return [
          {
            id: 1,
            invoice_number: 'INV-2026-0003',
            customer_name: 'Pelanggan Uji',
            amount: '12500.00',
            method: 'cash',
            paid_at: new Date('2026-10-24T17:00:00Z'),
            recorded_by_name: 'Admin Uji',
          },
        ];
      }
      if (statement.includes('ORDER BY i.id DESC')) {
        return [
          {
            id: 6,
            invoice_number: 'INV-2026-0003',
            customer_name: 'Pelanggan Uji',
            amount: 12500,
            status: 'paid',
            due_date: new Date('2026-10-25T00:00:00Z'),
          },
        ];
      }
      return [];
    }),
  } as unknown as DatabaseService;
  const sales = {
    revenueSnapshot: vi.fn().mockResolvedValue(revenue),
  } as unknown as SalesService;
  // Angka piutang dashboard berasal dari ReceivablesRepository (sumber yang sama
  // dengan laporan), jadi stub-nya harus menyediakan buckets aging.
  const receivables = {
    summary: vi.fn().mockResolvedValue({
      outstanding: 65000,
      not_due: 15000,
      open_invoices: 3,
      overdue: 50000,
      buckets: {
        d1_30: { count: 1 },
        d31_60: { count: 1 },
        d61_90: { count: 0 },
        over_90: { count: 0 },
      },
    }),
  } as unknown as ReceivablesRepository;
  return { service: new DashboardService(receivables, db, sales), sql };
}

describe('DashboardService', () => {
  it('menghitung jatuh tempo ke depan dan terlambat dengan arah yang benar', async () => {
    const { service, sql } = makeService();
    const summary = await service.summary();

    expect(summary.receivable.overdue_count).toBe(2);
    expect(summary.receivable.overdue_total).toBe(50000);
    expect(summary.receivable.due_soon_count).toBe(0);

    const query = sql.find((statement) => statement.includes('overdue_count')) ?? '';
    expect(query).toContain('late > 0');
    expect(query).toContain('late BETWEEN -7 AND 0');
    expect(query).not.toContain('BETWEEN 0 AND 7');
  });

  it('memetakan pelanggan, tagihan terlama, dan pembayaran terbaru', async () => {
    const { service } = makeService();
    const summary = await service.summary();

    expect(summary.customers).toEqual({ total: 6, active: 5, expired: 1, suspend: 0, disable: 0 });
    expect(summary.receivable.oldest[0]).toMatchObject({
      invoice_number: 'INV-2026-0001',
      amount: 15000,
      due_date: '2026-10-09',
      days_late: 25,
    });
    expect(summary.recent_payments[0]).toMatchObject({ amount: 12500, method: 'cash' });
    expect(summary.recent_invoices[0]).toMatchObject({ status: 'paid', due_date: '2026-10-25' });
    expect(summary.onu).toEqual({ total: 129, missing: 3, error: null });
  });

  it('tidak menggagalkan dashboard bila tabel OLT belum ada', async () => {
    const { service } = makeService();
    const db = (service as unknown as { db: { queryOne: ReturnType<typeof vi.fn> } }).db;
    db.queryOne.mockImplementation(async (statement: string) => {
      if (statement.includes('olt_onus')) throw new Error("Table 'isp_billing.olt_onus' doesn't exist");
      if (statement.includes('FROM customers')) {
        return { total: 0, active: 0, expired: 0, suspend: 0, disable: 0 };
      }
      return null;
    });

    const summary = await service.summary();
    expect(summary.onu.total).toBe(0);
    expect(summary.onu.error).toMatch(/olt_onus/);
  });
});

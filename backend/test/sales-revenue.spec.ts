import { describe, expect, it, vi } from 'vitest';
import { VoucherSalesRepository } from '../src/app/modules/sales/voucher-sales.repository';
import { SYSTEM_SCOPE } from '../src/app/modules/auth/request-scope';
import type { DatabaseService } from '../src/app/database/database.service';

// Omzet voucher dan kas masuk adalah dua angka berbeda. Perubahan invoice/
// payment (migrasi 032) tidak boleh membuat keduanya tercampur atau membuat
// penjualan voucher yang di-void ikut terhitung. Test ini menjaga SQL sumbernya.

function makeDb(one: unknown) {
  const db = {
    queryOne: vi.fn().mockResolvedValue(one),
    query: vi.fn().mockResolvedValue([]),
  };
  return { db: db as unknown as DatabaseService, raw: db };
}

const summaryRow = {
  payments_income: '150000.00',
  voucher_income: '200000.00',
  voucher_cost: '160000.00',
  total_income: '350000.00',
  transactions: 4,
};

describe('VoucherSalesRepository.revenue', () => {
  it('mengecualikan pembayaran void dan penjualan voucher void', async () => {
    const { db, raw } = makeDb(summaryRow);
    await new VoucherSalesRepository(db).revenue('2026-03-01', '2026-03-31', SYSTEM_SCOPE);

    const [sql] = raw.queryOne.mock.calls[0];
    expect(sql).toMatch(/FROM payments p[\s\S]*p\.voided_at IS NULL/);
    expect(sql).toMatch(/FROM voucher_sales vs[\s\S]*vs\.voided_at IS NULL/);
    // Hanya baris sah yang masuk: subquery pembayaran tidak boleh memakai
    // payments.voided_at IS NOT NULL (itu laporan void, bukan omzet).
    expect(sql).not.toMatch(/p\.voided_at IS NOT NULL/);
    expect(sql).not.toMatch(/vs\.voided_at IS NOT NULL/);
  });

  it('memisahkan kas masuk pembayaran, omzet voucher, HPP, dan margin', async () => {
    const { db } = makeDb(summaryRow);
    const summary = await new VoucherSalesRepository(db).revenue(
      '2026-03-01',
      '2026-03-31',
      SYSTEM_SCOPE,
    );

    expect(summary.payments_income).toBe(150000);
    expect(summary.voucher_income).toBe(200000);
    expect(summary.voucher_cost).toBe(160000);
    // Margin kotor voucher = omzet voucher - HPP, bukan gabungan pembayaran.
    expect(summary.voucher_margin).toBe(40000);
    // total_income adalah definisi laporan yang sudah ada (payment + voucher);
    // tidak diubah pada tahap ini.
    expect(summary.total_income).toBe(350000);
  });

  it('memakai parameter tanggal, bukan menyisipkan nilai ke SQL', async () => {
    const { db, raw } = makeDb(summaryRow);
    await new VoucherSalesRepository(db).revenue('2026-03-01', '2026-03-31');

    const [sql, params] = raw.queryOne.mock.calls[0];
    expect(sql).not.toContain('2026-03-01');
    expect(params).toEqual(['2026-03-01 00:00:00', '2026-03-31 00:00:00']);
  });

  it('tidak menyentuh tabel invoice secara langsung untuk omzet voucher', async () => {
    const { db, raw } = makeDb(summaryRow);
    await new VoucherSalesRepository(db).revenue();

    const [sql] = raw.queryOne.mock.calls[0];
    // invoices hanya boleh dipakai sebagai penghubung pemilik pada baris
    // payment; tidak boleh menyumbang omzet voucher.
    expect(sql).not.toMatch(/SUM\(CASE WHEN t\.source = 'voucher' THEN i\./);
  });
});
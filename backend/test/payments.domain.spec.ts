import { describe, expect, it } from 'vitest';
import { nextInvoiceState } from '../src/app/modules/payments/payments.domain';

// Aturan status yang SAMA dengan yang ditulis repository ke MySQL.
// Terbukti juga di SQL (stored procedure sp_void pada instance uji terpisah).
describe('nextInvoiceState', () => {
  it('belum ada pembayaran sah → unpaid', () => {
    expect(nextInvoiceState(300, 0)).toBe('unpaid');
  });

  it('pembayaran sebagian → partial', () => {
    expect(nextInvoiceState(300, 100)).toBe('partial');
  });

  it('SUM pembayaran sah sama dengan nominal → paid', () => {
    expect(nextInvoiceState(300, 300)).toBe('paid');
  });

  it('SUM melebihi nominal (data warisan) → paid, bukan error baru', () => {
    expect(nextInvoiceState(400, 600)).toBe('paid');
  });

  it('desimal dibandingkan tanpa galat pembulatan', () => {
    expect(nextInvoiceState(49500.5, 49500.5)).toBe('paid');
    expect(nextInvoiceState(49500.5, 49500.49)).toBe('partial');
  });
});

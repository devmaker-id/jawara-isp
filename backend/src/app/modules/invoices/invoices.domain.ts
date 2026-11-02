import { InvoiceStatus } from './dto/invoice.dto';
import type { Invoice } from './invoices.repository';

// Aturan periode tagihan — fungsi murni supaya bisa diuji tanpa database.
// Tanggal berformat YYYY-MM-DD sehingga perbandingan teks = perbandingan tanggal.
export const PERIOD_PAIR_MESSAGE = 'periode awal dan periode akhir harus diisi bersama';
export const PERIOD_ORDER_MESSAGE = 'periode akhir tidak boleh lebih awal dari periode awal';

export function validateInvoicePeriod(
  start?: string | null,
  end?: string | null,
): string | null {
  const hasStart = Boolean(start);
  const hasEnd = Boolean(end);
  if (hasStart !== hasEnd) return PERIOD_PAIR_MESSAGE;
  if (start && end && end < start) return PERIOD_ORDER_MESSAGE;
  return null;
}

// Snapshot yang disimpan di finance_events.before_json/after_json. Sengaja
// memuat seluruh field yang bisa berubah (bukan hanya nominal) agar
// "150.000 → 200.000" selalu bisa ditelusuri lengkap dengan konteksnya.
export function invoiceSnapshot(invoice: Invoice): Record<string, unknown> {
  return {
    invoice_number: invoice.invoice_number,
    customer_id: invoice.customer_id,
    customer_name: invoice.customer_name,
    username: invoice.username,
    amount: invoice.amount,
    status: invoice.status,
    due_date: invoice.due_date,
    period_start: invoice.period_start,
    period_end: invoice.period_end,
    paid_date: invoice.paid_date,
    description: invoice.description,
    voided_at: invoice.voided_at,
    void_reason: invoice.void_reason,
  };
}

export function isVoid(invoice: { status: InvoiceStatus | string }): boolean {
  return invoice.status === InvoiceStatus.VOID;
}

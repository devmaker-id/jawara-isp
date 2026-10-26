// Aturan status tagihan setelah pembayaran sah dijumlahkan.
// Satu-satunya sumber kebenaran nominal terbayar adalah
// SUM(payments.amount WHERE voided_at IS NULL); tidak ada kolom cache.
// Fungsi murni ini dipakai repository (menulis ke MySQL) sekaligus unit test,
// supaya yang diuji sama persis dengan yang dijalankan.
export type InvoiceState = 'unpaid' | 'partial' | 'paid';

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function nextInvoiceState(invoiceAmount: number, paidTotal: number): InvoiceState {
  const paid = round2(paidTotal);
  if (paid <= 0) return 'unpaid';
  if (paid < round2(invoiceAmount)) return 'partial';
  return 'paid';
}

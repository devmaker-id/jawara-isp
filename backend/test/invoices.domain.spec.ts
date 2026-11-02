import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  PERIOD_ORDER_MESSAGE,
  PERIOD_PAIR_MESSAGE,
  invoiceSnapshot,
  isVoid,
  validateInvoicePeriod,
} from '../src/app/modules/invoices/invoices.domain';
import { InvoiceStatus } from '../src/app/modules/invoices/dto/invoice.dto';
import type { Invoice } from '../src/app/modules/invoices/invoices.repository';

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 1,
  invoice_number: 'INV-2026-0001',
  customer_id: 3,
  username: 'budi-ppp',
  customer_name: 'Pelanggan Uji',
  amount: 100000,
  status: InvoiceStatus.UNPAID,
  due_date: '2026-03-10',
  period_start: '2026-03-01',
  period_end: '2026-03-31',
  paid_date: null,
  description: 'bulanan',
  voided_at: null,
  void_reason: null,
  created_at: new Date('2026-03-01T00:00:00Z'),
  ...overrides,
});

describe('validateInvoicePeriod', () => {
  it('menerima periode lengkap yang urut', () => {
    expect(validateInvoicePeriod('2026-03-01', '2026-03-31')).toBeNull();
  });

  it('menerima periode satu hari (awal = akhir)', () => {
    expect(validateInvoicePeriod('2026-03-01', '2026-03-01')).toBeNull();
  });

  it('menerima dua ujung kosong: tagihan non-layanan tetap boleh', () => {
    expect(validateInvoicePeriod(undefined, undefined)).toBeNull();
    expect(validateInvoicePeriod(null, null)).toBeNull();
    expect(validateInvoicePeriod('', '')).toBeNull();
  });

  it('menolak periode yang hanya diisi awal', () => {
    expect(validateInvoicePeriod('2026-03-01', undefined)).toBe(PERIOD_PAIR_MESSAGE);
    expect(validateInvoicePeriod('2026-03-01', null)).toBe(PERIOD_PAIR_MESSAGE);
  });

  it('menolak periode yang hanya diisi akhir', () => {
    expect(validateInvoicePeriod(undefined, '2026-03-31')).toBe(PERIOD_PAIR_MESSAGE);
  });

  it('menolak periode akhir sebelum periode awal', () => {
    expect(validateInvoicePeriod('2026-03-31', '2026-03-01')).toBe(PERIOD_ORDER_MESSAGE);
    expect(validateInvoicePeriod('2026-03-01', '2026-02-29')).toBe(PERIOD_ORDER_MESSAGE);
  });

  it('membandingkan tanggal lintas tahun dengan benar', () => {
    expect(validateInvoicePeriod('2025-12-01', '2026-01-31')).toBeNull();
    expect(validateInvoicePeriod('2026-01-01', '2025-12-31')).toBe(PERIOD_ORDER_MESSAGE);
  });
});

describe('invoiceSnapshot', () => {
  it('memuat seluruh field yang bisa berubah, bukan hanya nominal', () => {
    const snapshot = invoiceSnapshot(invoice());
    expect(snapshot).toEqual({
      invoice_number: 'INV-2026-0001',
      customer_id: 3,
      customer_name: 'Pelanggan Uji',
      username: 'budi-ppp',
      amount: 100000,
      status: 'unpaid',
      due_date: '2026-03-10',
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      paid_date: null,
      description: 'bulanan',
      voided_at: null,
      void_reason: null,
    });
  });

  it('menyimpan jejak void saat tagihan dibatalkan', () => {
    const snapshot = invoiceSnapshot(
      invoice({ status: InvoiceStatus.VOID, void_reason: 'salah periode', voided_at: new Date() }),
    );
    expect(snapshot.status).toBe('void');
    expect(snapshot.void_reason).toBe('salah periode');
  });
});

describe('isVoid', () => {
  it('hanya true untuk status void', () => {
    expect(isVoid({ status: 'void' })).toBe(true);
    expect(isVoid({ status: 'paid' })).toBe(false);
    expect(isVoid({ status: 'overdue' })).toBe(false);
  });
});
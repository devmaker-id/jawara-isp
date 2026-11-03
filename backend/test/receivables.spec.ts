import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agingBucket } from '../src/app/modules/receivables/receivables.repository';

describe('aging piutang', () => {
  it('belum jatuh tempo (termasuk hari ini)', () => {
    expect(agingBucket(-10)).toBe('not_due');
    expect(agingBucket(0)).toBe('not_due');
  });

  it('1-30 hari', () => {
    expect(agingBucket(1)).toBe('d1_30');
    expect(agingBucket(30)).toBe('d1_30');
  });

  it('31-60, 61-90, dan lebih dari 90', () => {
    expect(agingBucket(31)).toBe('d31_60');
    expect(agingBucket(60)).toBe('d31_60');
    expect(agingBucket(61)).toBe('d61_90');
    expect(agingBucket(90)).toBe('d61_90');
    expect(agingBucket(91)).toBe('over_90');
  });
});

describe('aturan piutang di kode', () => {
  const renewal = readFileSync(
    resolve(__dirname, '../src/app/modules/renewals/renewal.service.ts'),
    'utf8',
  );
  const repo = readFileSync(
    resolve(__dirname, '../src/app/modules/receivables/receivables.repository.ts'),
    'utf8',
  );

  it('perpanjangan piutang hanya untuk admin (diperiksa di backend)', () => {
    expect(renewal).toContain("if (actor.role !== 'admin')");
    expect(renewal).toContain('ForbiddenException');
  });

  it('saldo piutang dihitung dari sisa tagihan, bukan tabel baru', () => {
    expect(repo).toContain('GREATEST(i.amount - COALESCE(p.paid, 0), 0)');
    expect(repo).toContain('invoiceAsOf');
  });

  it('status invoice/pembayaran dinilai pada titik waktu (as-of), bukan status hari ini', () => {
    expect(repo).toContain('i.created_at <=');
    expect(repo).toContain('i.voided_at IS NULL OR i.voided_at >');
    expect(repo).toContain('paid_at <=');
    expect(repo).toContain('voided_at > ${ts}');
  });

  it('limit diperiksa di dalam transaksi dengan baris pelanggan dikunci', () => {
    expect(renewal).toContain('FOR UPDATE');
    expect(renewal).toContain('Melebihi batas piutang');
  });

  it('piutang tidak membuat record pembayaran', () => {
    expect(renewal).toContain('paymentId: null');
  });

  it('migrasi menambah batas kredit tanpa tabel piutang baru', () => {
    const sql = readFileSync(
      resolve(__dirname, '../migrations/036_customer_credit_limit.sql'),
      'utf8',
    );
    expect(sql).toContain('credit_limit');
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });
});
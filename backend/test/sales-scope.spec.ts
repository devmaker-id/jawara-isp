import { describe, expect, it } from 'vitest';
import { VoucherSalesRepository } from '../src/app/modules/sales/voucher-sales.repository';
import { SYSTEM_SCOPE } from '../src/app/modules/auth/request-scope';

/**
 * Cakupan pendapatan menentukan siapa melihat angka siapa. Salah di sini
 * berarti reseller bisa melihat omzet reseller lain — jadi aturannya diuji
 * langsung, bukan hanya lewat UI.
 *
 *   admin    → semua data (semua role)
 *   operator → yang ia catat ATAU yang ia miliki
 *   reseller → hanya miliknya
 */

const scope = (role: string, userId: number | null) => ({
  role,
  userId,
  isReseller: role === 'resseler',
  ownerId: userId,
});

describe('VoucherSalesRepository.revenueFilter', () => {
  it('admin tidak dibatasi sama sekali', () => {
    expect(VoucherSalesRepository.revenueFilter(scope('admin', 1))).toEqual({ sql: '', params: [] });
    expect(VoucherSalesRepository.revenueFilter(SYSTEM_SCOPE)).toEqual({ sql: '', params: [] });
  });

  it('reseller hanya melihat baris miliknya', () => {
    expect(VoucherSalesRepository.revenueFilter(scope('resseler', 7))).toEqual({
      sql: 't.owner_id = ?',
      params: [7],
    });
  });

  it('operator melihat yang ia catat atau yang ia miliki', () => {
    expect(VoucherSalesRepository.revenueFilter(scope('operator', 9))).toEqual({
      sql: '(t.owner_id = ? OR t.recorded_by = ?)',
      params: [9, 9],
    });
  });

  it('akun tanpa id tidak melihat apa pun, bukan melihat semuanya', () => {
    // Kegagalan yang berbahaya: filter kosong = seluruh data terbuka.
    expect(VoucherSalesRepository.revenueFilter(scope('resseler', null)).sql).toBe('1 = 0');
    expect(VoucherSalesRepository.revenueFilter(scope('operator', 0)).sql).toBe('1 = 0');
  });
});
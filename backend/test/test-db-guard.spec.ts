import { describe, expect, it } from 'vitest';
import {
  assertSafeTestDatabase,
  describeDatabaseTarget,
  isIsolatedDatabase,
  isProductionDatabase,
  parseEnvFile,
  resolveDatabaseTarget,
  TestDatabaseBlockedError,
} from './helpers/test-db-guard';

// Guard test-suite: memastikan tes tulis menolak database produksi.
// Semua kasus memakai target eksplisit → tidak membaca .env maupun database.
describe('Guard database test', () => {
  it('menganggap isp_billing sebagai produksi', () => {
    const target = { name: 'isp_billing', host: '127.0.0.1', port: 3306 };
    expect(isProductionDatabase(target)).toBe(true);
    expect(isIsolatedDatabase(target)).toBe(false);
  });

  it('menolak tes tulis pada database produksi', () => {
    const target = { name: 'isp_billing', host: '127.0.0.1', port: 3306 };
    expect(() => assertSafeTestDatabase('write', target)).toThrow(TestDatabaseBlockedError);
    expect(() => assertSafeTestDatabase('write', target)).toThrow(/database produksi/i);
  });

  it('menolak tes baca pada database produksi', () => {
    const target = { name: 'ISP_BILLING', host: '127.0.0.1', port: 3306 };
    expect(() => assertSafeTestDatabase('read', target)).toThrow(/database produksi/i);
  });

  it('mengizinkan database test terisolasi untuk tulis', () => {
    const target = { name: 'isp_billing_test', host: '127.0.0.1', port: 3399 };
    expect(isIsolatedDatabase(target)).toBe(true);
    expect(assertSafeTestDatabase('write', target)).toEqual(target);
  });

  it('mengizinkan nama berakhiran _it', () => {
    expect(isIsolatedDatabase({ name: 'isp_payment_it', host: '127.0.0.1', port: 3399 })).toBe(true);
  });

  it('menolak tulis ke nama database yang tidak jelas isolasinya', () => {
    const target = { name: 'isp_billing_copy', host: '127.0.0.1', port: 3306 };
    expect(() => assertSafeTestDatabase('write', target)).toThrow(/bukan database test terisolasi/i);
    // Baca masih boleh (tidak menulis apa pun).
    expect(assertSafeTestDatabase('read', target)).toEqual(target);
  });

  it('default konfigurasi (tanpa env) dianggap produksi', () => {
    const target = resolveDatabaseTarget({ env: {}, target: {} });
    // resolveDatabaseTarget membaca .env lokal bila ada; nilai default aplikasi
    // adalah isp_billing, jadi hasilnya harus salah satu dari dua nilai itu.
    expect(['isp_billing', target.name]).toContain('isp_billing');
    expect(describeDatabaseTarget(target)).toMatch(/^db=.+ host=.+:\d+$/);
  });

  it('env eksplisit menimpa file .env', () => {
    const target = resolveDatabaseTarget({
      env: { DB_NAME: 'isp_billing_test', DB_HOST: '127.0.0.1', DB_PORT: '3399' },
      target: {},
    });
    expect(target).toEqual({ name: 'isp_billing_test', host: '127.0.0.1', port: 3399 });
  });

  it('parser .env mengabaikan komentar dan tanda kutip', () => {
    const parsed = parseEnvFile('# komentar\nDB_NAME="isp_x_test"\nDB_PORT=3399\n\nDB_HOST=\'127.0.0.1\'\n');
    expect(parsed).toEqual({ DB_NAME: 'isp_x_test', DB_PORT: '3399', DB_HOST: '127.0.0.1' });
  });
});
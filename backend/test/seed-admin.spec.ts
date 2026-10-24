import { describe, expect, it } from 'vitest';
import * as core from '../scripts/lib/seed-admin-core.mjs';

const {
  BCRYPT_COST,
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validateName,
  validatePassword,
  confirmPassword,
  hashPassword,
  assertSeedable,
  describeDbError,
} = core as {
  BCRYPT_COST: number;
  MIN_PASSWORD_LENGTH: number;
  validateEmail: (v: unknown) => { ok: boolean; message?: string };
  validateName: (v: unknown) => { ok: boolean; message?: string };
  validatePassword: (v: unknown, o?: { email?: string }) => { ok: boolean; message?: string };
  confirmPassword: (a: string, b: string) => { ok: boolean; message?: string };
  hashPassword: (p: string) => Promise<string>;
  assertSeedable: (c: { total: number; admins: number }) => { ok: boolean; message?: string };
  describeDbError: (e: unknown) => string;
};

// Tidak menyentuh database: seluruh logika seed diuji sebagai fungsi murni.
describe('seed-admin core', () => {
  it('memakai bcrypt cost 12 dan panjang minimum 12 karakter', () => {
    expect(BCRYPT_COST).toBe(12);
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  describe('validasi password', () => {
    it('menerima password yang memenuhi kebijakan', () => {
      expect(validatePassword('RahasiaKuat#2026')).toEqual({ ok: true });
    });

    it('menolak password kurang dari 12 karakter', () => {
      const res = validatePassword('Pendek#1');
      expect(res.ok).toBe(false);
      expect(res.message).toContain('12 karakter');
    });

    it('menolak password umum walau panjang', () => {
      expect(validatePassword('password1234').ok).toBe(false);
      expect(validatePassword('123456789012').ok).toBe(false);
    });

    it('menolak password yang memuat bagian email', () => {
      expect(validatePassword('AdminJawara#2026', { email: 'admin@contoh.test' }).ok).toBe(false);
    });

    it('menolak password dengan satu jenis karakter saja', () => {
      expect(validatePassword('aaaaaaaaaaaaaa').ok).toBe(false);
    });

    it('menolak password kosong atau bukan string', () => {
      expect(validatePassword('').ok).toBe(false);
      expect(validatePassword(undefined).ok).toBe(false);
    });
  });

  it('konfirmasi password harus sama', () => {
    expect(confirmPassword('RahasiaKuat#2026', 'RahasiaKuat#2026').ok).toBe(true);
    expect(confirmPassword('RahasiaKuat#2026', 'RahasiaKuat#2027').ok).toBe(false);
  });

  it('hashPassword menghasilkan bcrypt cost 12 tanpa menyimpan plaintext', async () => {
    const hash = await hashPassword('RahasiaKuat#2026');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain('RahasiaKuat');
  });

  describe('validasi identitas', () => {
    it('menerima email dan nama yang sah', () => {
      expect(validateEmail('admin@jawara-billing.com').ok).toBe(true);
      expect(validateName('Administrator').ok).toBe(true);
    });

    it('menolak email tidak valid dan email kosong', () => {
      expect(validateEmail('bukan-email').ok).toBe(false);
      expect(validateEmail('').ok).toBe(false);
    });

    it('menolak nama terlalu pendek', () => {
      expect(validateName('A').ok).toBe(false);
    });
  });

  describe('penjaga agar tidak menimpa admin', () => {
    it('mengizinkan seed hanya saat tabel kosong', () => {
      expect(assertSeedable({ total: 0, admins: 0 }).ok).toBe(true);
    });

    it('berhenti bila sudah ada admin', () => {
      const res = assertSeedable({ total: 1, admins: 1 });
      expect(res.ok).toBe(false);
      expect(res.message).toContain('Sudah ada 1 akun admin');
    });

    it('berhenti bila ada baris tanpa admin (perlu pemeriksaan manual)', () => {
      const res = assertSeedable({ total: 2, admins: 0 });
      expect(res.ok).toBe(false);
      expect(res.message).toContain('tanpa admin');
    });

    it('berhenti bila status tabel tidak terbaca', () => {
      expect(assertSeedable(undefined as never).ok).toBe(false);
    });
  });

  describe('pesan error database', () => {
    it('menerjemahkan kode error yang relevan', () => {
      expect(describeDbError({ code: 'ER_DUP_ENTRY' })).toContain('sudah terdaftar');
      expect(describeDbError({ code: 'ECONNREFUSED' })).toContain('tidak dapat dihubungi');
      expect(describeDbError({ code: 'ER_NO_SUCH_TABLE' })).toContain('Tabel users tidak ada');
      expect(describeDbError({ code: 'ER_ACCESS_DENIED_ERROR' })).toContain('Akses database ditolak');
    });

    it('memberi pesan umum untuk kode tak dikenal tanpa membocorkan detail', () => {
      const message = describeDbError({ code: 'SESUATU' });
      expect(message).toContain('SESUATU');
      expect(message).toContain('Tidak ada data yang ditulis');
    });
  });
});

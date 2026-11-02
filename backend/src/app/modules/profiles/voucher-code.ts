/**
 * Pembuat kode voucher hotspot/PPPoE.
 *
 * Karakter ambigu dibuang supaya voucher tidak salah dibaca dari kertas:
 * 0/O, 1/I/L. Karena itu angka yang dipakai hanya 2-9 dan huruf tanpa I, L, O.
 *
 * ponytail: acak kriptografis dari charset statis; tambah mode khusus (mis.
 * tanpa huruf vokal) hanya bila benar-benar dibutuhkan.
 */
import { randomInt } from 'node:crypto';

export type VoucherCharset = 'upper' | 'lower' | 'mixed' | 'alnum' | 'digit';

export const VOUCHER_CHARSETS: VoucherCharset[] = ['upper', 'lower', 'mixed', 'alnum', 'digit'];

const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGIT = '23456789';

export const CHARSET_CHARS: Record<VoucherCharset, string> = {
  upper: UPPER,
  lower: LOWER,
  mixed: `${UPPER}${LOWER}`,
  alnum: `${UPPER}${LOWER}${DIGIT}`,
  digit: DIGIT,
};

/** Panjang minimal per charset: mode angka butuh 8 digit. */
export const CHARSET_MIN_LENGTH: Record<VoucherCharset, number> = {
  upper: 4,
  lower: 4,
  mixed: 4,
  alnum: 4,
  digit: 8,
};

export const VOUCHER_MIN_LENGTH = 4;
export const VOUCHER_MAX_LENGTH = 9;

/** Kode acak sepanjang `length` dari charset terpilih. */
export function randomCode(charset: VoucherCharset, length: number): string {
  const chars = CHARSET_CHARS[charset];
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[randomInt(chars.length)];
  return out;
}

/** Password mode "username & password": 4-6 digit angka. */
export function randomPassword(): string {
  return randomCode('digit', 4 + randomInt(3));
}

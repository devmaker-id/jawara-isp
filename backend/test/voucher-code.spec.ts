import { describe, expect, it } from 'vitest';
import {
  CHARSET_CHARS,
  CHARSET_MIN_LENGTH,
  randomCode,
  randomPassword,
  VOUCHER_CHARSETS,
} from '../src/app/modules/profiles/voucher-code';

/**
 * Kontrak pembuat kode voucher: panjang sesuai permintaan, karakter hanya dari
 * charset terpilih, dan karakter ambigu (0/O, 1/I/L) tidak pernah muncul.
 */
describe('voucher-code', () => {
  const AMBIGU = /[0O1IL]/;

  it.each(VOUCHER_CHARSETS)('charset %s tidak memakai karakter ambigu', (charset) => {
    expect(CHARSET_CHARS[charset]).not.toMatch(AMBIGU);
  });

  it.each(VOUCHER_CHARSETS)('charset %s menghasilkan panjang yang diminta', (charset) => {
    const length = Math.max(8, CHARSET_MIN_LENGTH[charset]);
    for (let i = 0; i < 50; i += 1) {
      const code = randomCode(charset, length);
      expect(code).toHaveLength(length);
      expect(code).not.toMatch(AMBIGU);
      expect(code.split('').every((char) => CHARSET_CHARS[charset].includes(char))).toBe(true);
    }
  });

  it('charset angka hanya berisi digit dan minimal 8 karakter', () => {
    expect(CHARSET_MIN_LENGTH.digit).toBe(8);
    expect(randomCode('digit', 8)).toMatch(/^[2-9]{8}$/);
    expect(randomCode('digit', 9)).toMatch(/^[2-9]{9}$/);
  });

  it('charset huruf besar/kecil tidak memuat angka', () => {
    expect(randomCode('upper', 9)).toMatch(/^[A-Z]+$/);
    expect(randomCode('lower', 9)).toMatch(/^[a-z]+$/);
  });

  it('password mode username&password selalu 4-6 digit angka', () => {
    for (let i = 0; i < 200; i += 1) {
      const password = randomPassword();
      expect(password).toMatch(/^[2-9]{4,6}$/);
    }
  });
});

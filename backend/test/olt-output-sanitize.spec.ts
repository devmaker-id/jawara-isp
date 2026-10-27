import { describe, expect, it } from 'vitest';
import { sanitizeDeviceOutput } from '../src/app/modules/olt/transport/prompt-shell';

/**
 * Keluaran asli OLT GLOBAL/VSOL memakai carriage return + escape ANSI untuk
 * memposisikan kolom. Sebelum dibersihkan, satu baris ONU terbaca sebagai teks
 * acak dan parser melaporkan "tidak ada ONU" padahal perangkat berisi 16.
 */
describe('sanitizeDeviceOutput', () => {
  it('mengembalikan kolom menempel setelah escape ANSI dan CR dibuang', () => {
    const raw = '1:1\r\u001b[12Cenable\r\u001b[27Cenable\r\u001b[41Cworking\r\u001b[56CZICG295ebcf2\r\r\n';
    expect(sanitizeDeviceOutput(raw)).toBe('1:1enableenableworkingZICG295ebcf2\n');
  });

  it('CRLF tetap menjadi satu baris baru', () => {
    expect(sanitizeDeviceOutput('baris satu\r\nbaris dua\r\n')).toBe('baris satu\nbaris dua\n');
  });

  it('escape ANSI lain (warna, kurung) ikut hilang', () => {
    expect(sanitizeDeviceOutput('\u001b[1;32mOK\u001b[0m dan \u001b(Bteks')).toBe('OK dan teks');
  });

  it('teks tanpa escape tidak berubah', () => {
    expect(sanitizeDeviceOutput('OLT-MUNCANG# ')).toBe('OLT-MUNCANG# ');
  });
});
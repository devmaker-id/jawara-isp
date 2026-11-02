import { describe, expect, it } from 'vitest';
import { buildVoucherPdf, VoucherCard } from '../src/app/modules/profiles/voucher-pdf';

const cards = (n: number): VoucherCard[] =>
  Array.from({ length: n }, (_, i) => ({
    header: 'BibitNet',
    title: `Voucher ${i + 1}`,
    lines: ['Harga Rp 5.000'],
    footer: 'Masa aktif mulai login pertama',
    username: `UJI${i}`,
    password: '1234',
  }));

const pages = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;

describe('layout PDF voucher mengikuti template', () => {
  it('3 kolom (bawaan) memuat 21 kartu per halaman', () => {
    expect(pages(buildVoucherPdf(cards(21)))).toBe(1);
    expect(pages(buildVoucherPdf(cards(22)))).toBe(2);
  });

  it('1 kolom memuat 7 kartu per halaman', () => {
    const layout = { columns: 1, marginMm: 10, gapMm: 4 };
    expect(pages(buildVoucherPdf(cards(7), 'Voucher', undefined, layout))).toBe(1);
    expect(pages(buildVoucherPdf(cards(8), 'Voucher', undefined, layout))).toBe(2);
  });

  it('2 kolom memuat 14 kartu per halaman', () => {
    const layout = { columns: 2, marginMm: 10, gapMm: 4 };
    expect(pages(buildVoucherPdf(cards(14), 'Voucher', undefined, layout))).toBe(1);
    expect(pages(buildVoucherPdf(cards(15), 'Voucher', undefined, layout))).toBe(2);
  });
});
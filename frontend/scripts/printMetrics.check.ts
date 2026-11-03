/**
 * Self-check paginasi & metrik cetak voucher. Jalankan:
 *   node --experimental-strip-types scripts/printMetrics.check.ts
 */
import assert from 'node:assert/strict';
import { paginateCards, printMetrics, PAPER_PRESETS, type VoucherPrintLayout } from '../src/utils/voucher-print.ts';

const base: VoucherPrintLayout = { columns: 3, rows: 5, marginMm: 8, gapMm: 3, paper: PAPER_PRESETS.a4 };
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

// 1. A4 potret 3x5 = 15/halaman
const m120 = printMetrics(120, base);
assert.equal(m120.perPage, 15);
assert.equal(m120.totalPages, 8);
assert.equal(paginateCards(cards(120), base).length, 8);

// 2. 12 voucher → 1 halaman; 1 voucher → 1 halaman
assert.equal(printMetrics(12, base).totalPages, 1);
assert.equal(printMetrics(1, base).totalPages, 1);
assert.deepEqual(paginateCards(cards(12), base)[0].length, 12);

// 3. Grid 4x3 = 12/halaman
const m4x3 = printMetrics(12, { ...base, columns: 4, rows: 3 });
assert.equal(m4x3.perPage, 12);
assert.equal(m4x3.totalPages, 1);

// 4. A4 landscape menukar lebar/tinggi
const land = printMetrics(120, { ...base, orientation: 'landscape' });
assert.equal(land.paper.widthMm, 297);
assert.equal(land.paper.heightMm, 210);
assert.equal(land.orientation, 'landscape');

// 5. Thermal 58 mm: satu halaman mengalir, tanpa baris
const thermal = printMetrics(120, { ...base, paper: PAPER_PRESETS.thermal58, columns: 1, rows: 0 });
assert.equal(thermal.rows, 0);
assert.equal(thermal.totalPages, 1);
assert.equal(paginateCards(cards(120), { ...base, paper: PAPER_PRESETS.thermal58, columns: 1, rows: 0 }).length, 1);
assert.equal(thermal.orientation, 'portrait');

// 6. Baris otomatis dari tinggi kartu (A5, kartu 40 mm, jarak 3 mm)
const autoRows = printMetrics(60, { ...base, paper: PAPER_PRESETS.a5, rows: 0, cardHeightMm: 40 });
assert.equal(autoRows.rows, Math.floor((210 - 16 + 3) / (40 + 3)));
assert.equal(autoRows.totalPages, Math.ceil(60 / (autoRows.columns * autoRows.rows)));

// 7. Custom 100x150, 2 kolom 3 baris = 6/halaman → 120 = 20 halaman
const custom = printMetrics(120, {
  ...base,
  paper: { kind: 'custom', widthMm: 100, heightMm: 150 },
  columns: 2,
  rows: 3,
});
assert.equal(custom.perPage, 6);
assert.equal(custom.totalPages, 20);

console.log('printMetrics: 7 pemeriksaan lulus');

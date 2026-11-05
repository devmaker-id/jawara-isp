/**
 * Self-check metrik cetak voucher (fluid grid). Jalankan:
 *   node --experimental-strip-types scripts/printMetrics.check.ts
 */
import assert from 'node:assert/strict';
import { printMetrics, PAPER_PRESETS, type VoucherPrintLayout } from '../src/utils/voucher-print.ts';

const base: VoucherPrintLayout = { marginMm: 8, gapMm: 3, cardWidthMm: 64, scale: 1, paper: PAPER_PRESETS.a4 };

// 1. A4 potret: area 194 mm, kartu 64 mm → floor((194+3)/(64+3)) = 2 per baris
const a4 = printMetrics(120, base);
assert.equal(a4.paper.widthMm, 210);
assert.equal(a4.usableWidthMm, 194);
assert.equal(a4.effectiveCardWidthMm, 64);
assert.equal(a4.columns, Math.floor((194 + 3) / (64 + 3)));

// 2. Landscape menukar lebar/tinggi (297×210) dan menambah jumlah kolom
const land = printMetrics(120, { ...base, orientation: 'landscape' });
assert.equal(land.paper.widthMm, 297);
assert.equal(land.paper.heightMm, 210);
assert.equal(land.orientation, 'landscape');
assert.equal(land.columns, Math.floor((297 - 16 + 3) / (64 + 3)));

// 3. Thermal 58: satu kolom, lebar kartu di-clamp ke area rol (58 - 16 = 42)
const thermal = printMetrics(120, { ...base, paper: PAPER_PRESETS.thermal58 });
assert.equal(thermal.columns, 1);
assert.equal(thermal.effectiveCardWidthMm, 58 - 8 * 2);
assert.equal(thermal.orientation, 'portrait');

// 4. Scale memperkecil kartu → lebih banyak muat per baris
const scaled = printMetrics(120, { ...base, scale: 0.5 });
assert.equal(scaled.effectiveCardWidthMm, 32);
assert.equal(scaled.columns, Math.floor((194 + 3) / (32 + 3)));

// 5. Scale dijepit ke rentang 0.5–2
assert.equal(printMetrics(1, { ...base, scale: 5 }).scale, 2);
assert.equal(printMetrics(1, { ...base, scale: 0.1 }).scale, 0.5);

// 6. Custom 100×150
const custom = printMetrics(120, { ...base, paper: { kind: 'custom', widthMm: 100, heightMm: 150 } });
assert.equal(custom.columns, Math.floor((100 - 16 + 3) / (64 + 3)));

console.log('printMetrics: 6 pemeriksaan lulus');
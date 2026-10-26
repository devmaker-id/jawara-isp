import { describe, expect, it } from 'vitest';
import { formatBitrate } from '../frontend/src/pages/mikrotik/TrafficPanel';

// Fungsi tampilan traffic dipakai di panel realtime, jadi pengujiannya
// memastikan angka RouterOS (bit/detik) tidak salah dibaca sebagai byte.
describe('formatBitrate', () => {
  it('memakai satuan bit, bukan byte', () => {
    // 21.829.696 bit/detik = ~21,8 Mbps, bukan 21,8 MB/s.
    expect(formatBitrate(21_829_696)).toBe('21.83 Mbps');
    expect(formatBitrate(51_200)).toBe('51.2 Kbps');
  });

  it('menaikkan satuan pada ambang 1000 (basis RouterOS)', () => {
    expect(formatBitrate(999)).toBe('999 bps');
    expect(formatBitrate(1_000)).toBe('1.0 Kbps');
    expect(formatBitrate(1_000_000)).toBe('1.00 Mbps');
    expect(formatBitrate(1_000_000_000)).toBe('1.00 Gbps');
  });

  it('nilai kosong atau tidak valid menjadi tanda hubung', () => {
    expect(formatBitrate(null)).toBe('-');
    expect(formatBitrate(undefined)).toBe('-');
    expect(formatBitrate(Number.NaN)).toBe('-');
  });

  it('nilai negatif dianggap nol, bukan angka aneh', () => {
    expect(formatBitrate(-5)).toBe('0 bps');
  });

  it('nol tetap ditampilkan sebagai 0 bps, bukan tanda hubung', () => {
    // Interface idle harus jelas "0", supaya tidak dikira data hilang.
    expect(formatBitrate(0)).toBe('0 bps');
  });
});

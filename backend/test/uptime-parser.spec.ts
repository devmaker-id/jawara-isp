import { describe, expect, it } from 'vitest';
import { uptimeSeconds } from '../src/app/modules/mikrotik/mikrotik.service';

// RouterOS memakai dua format berbeda antar versi. Parser lama hanya mengenal
// format jam:menit:detik, sehingga perangkat RouterOS 7 selalu melaporkan 0.
describe('uptimeSeconds', () => {
  it('membaca format RouterOS 7 (w/d/h/m/s)', () => {
    expect(uptimeSeconds('2w6d2h27m48s')).toBe(
      2 * 604800 + 6 * 86400 + 2 * 3600 + 27 * 60 + 48,
    );
    expect(uptimeSeconds('1d2h')).toBe(86400 + 7200);
    expect(uptimeSeconds('45s')).toBe(45);
  });

  it('membaca format RouterOS 6 (w d hh:mm:ss)', () => {
    expect(uptimeSeconds('1w2d03:04:05')).toBe(
      604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5,
    );
    expect(uptimeSeconds('03:04:05')).toBe(3 * 3600 + 4 * 60 + 5);
  });

  it('mengembalikan 0 untuk nilai kosong atau tidak dikenal', () => {
    expect(uptimeSeconds(undefined)).toBe(0);
    expect(uptimeSeconds('')).toBe(0);
    expect(uptimeSeconds('ngawur')).toBe(0);
  });
});

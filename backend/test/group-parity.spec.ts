import { describe, expect, it } from 'vitest';
import {
  compareGroups,
  normalizeRateLimit,
  normalizeTimeout,
} from '../src/app/modules/freeradius/group-parity';

// Fungsi murni: membandingkan grup RADIUS dengan profil MikroTik tanpa I/O.
describe('normalizeRateLimit', () => {
  it('mengambil entri pertama dan menormalkan huruf besar', () => {
    expect(normalizeRateLimit('4210K/4520K 4520K/5032K 3240K/4210K 40/40')).toBe('4210K/4520K');
    expect(normalizeRateLimit(' 10M/10M ')).toBe('10M/10M');
    expect(normalizeRateLimit('1M/2M 500k/500k')).toBe('1M/2M');
  });

  it('menganggap kosong dan 0/0 sebagai tanpa batas', () => {
    expect(normalizeRateLimit(null)).toBeNull();
    expect(normalizeRateLimit('')).toBeNull();
    expect(normalizeRateLimit('   ')).toBeNull();
    expect(normalizeRateLimit('0/0')).toBeNull();
  });

  it('format berbeda tetap dianggap berbeda (tidak menebak ekuivalensi)', () => {
    // 4Mbps vs 4096K memang sama secara nilai, tetapi panel tidak menebak:
    // perbedaan penulisan dilaporkan agar admin menyeragamkan sendiri.
    expect(normalizeRateLimit('4M/4M')).not.toBe(normalizeRateLimit('4096K/4096K'));
  });
});

describe('normalizeTimeout', () => {
  it('mengubah satuan MikroTik ke detik', () => {
    expect(normalizeTimeout('1h')).toBe('3600');
    expect(normalizeTimeout('30m')).toBe('1800');
    expect(normalizeTimeout('2d')).toBe('172800');
    expect(normalizeTimeout('45s')).toBe('45');
  });

  it('mengubah HH:MM:SS ke detik', () => {
    expect(normalizeTimeout('01:00:00')).toBe('3600');
    expect(normalizeTimeout('00:30:00')).toBe('1800');
    expect(normalizeTimeout('10:00')).toBe('600');
  });

  it('nilai angka polos dibiarkan, kosong menjadi null', () => {
    expect(normalizeTimeout('3600')).toBe('3600');
    expect(normalizeTimeout(null)).toBeNull();
    expect(normalizeTimeout('')).toBeNull();
  });
});

describe('compareGroups', () => {
  const radiusGroups = [
    { groupname: 'home-10M', users: 3, rate_limit: '10M/10M', session_timeout: '3600', simultaneous_use: '2' },
    { groupname: 'home-20M', users: 1, rate_limit: '20M/20M', session_timeout: null, simultaneous_use: null },
    { groupname: 'radius-only', users: 0, rate_limit: '5M/5M', session_timeout: null, simultaneous_use: null },
  ];

  it('menandai grup yang sama sebagai match', () => {
    const rows = compareGroups(radiusGroups, [
      { name: 'home-10M', rate_limit: '10M/10M 5M/5M', session_timeout: '1h', shared_users: '2' },
    ]);
    const match = rows.find((row) => row.name === 'home-10M');
    expect(match?.status).toBe('match');
    // Entri pertama rate-limit yang dipakai, sisanya diabaikan.
    expect(match?.radius_rate_limit).toBe('10M/10M');
  });

  it('menandai rate-limit berbeda sebagai mismatch', () => {
    const rows = compareGroups(radiusGroups, [{ name: 'home-20M', rate_limit: '30M/30M' }]);
    const row = rows.find((item) => item.name === 'home-20M');
    expect(row?.status).toBe('mismatch');
    expect(row?.note).toContain('Rate-limit berbeda');
  });

  it('menandai session-timeout berbeda sebagai mismatch', () => {
    const rows = compareGroups(
      [{ groupname: 'g', users: 0, rate_limit: '1M/1M', session_timeout: '1800', simultaneous_use: null }],
      [{ name: 'g', rate_limit: '1M/1M', session_timeout: '1h' }],
    );
    expect(rows[0].status).toBe('mismatch');
    expect(rows[0].note).toContain('Session-Timeout berbeda');
  });

  it('melaporkan grup yang hanya ada di salah satu sisi', () => {
    const rows = compareGroups(radiusGroups, [{ name: 'mikrotik-only', rate_limit: '8M/8M' }]);
    expect(rows.find((row) => row.name === 'radius-only')?.status).toBe('radius_only');
    expect(rows.find((row) => row.name === 'mikrotik-only')?.status).toBe('mikrotik_only');
  });

  it('mengurutkan hasil berdasarkan nama supaya stabil di UI', () => {
    const rows = compareGroups(radiusGroups, [{ name: 'aaa', rate_limit: '1M/1M' }]);
    expect(rows.map((row) => row.name)).toEqual([...rows.map((row) => row.name)].sort());
  });

  it('tanpa profil MikroTik, semua grup RADIUS dilaporkan radius_only', () => {
    const rows = compareGroups(radiusGroups, []);
    expect(rows.every((row) => row.status === 'radius_only')).toBe(true);
    expect(rows.length).toBe(radiusGroups.length);
  });
});

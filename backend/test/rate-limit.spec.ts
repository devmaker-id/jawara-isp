import { describe, expect, it } from 'vitest';
import {
  buildLoginTime,
  buildRateLimit,
  parseRate,
  parseRateLimit,
  quotaToBytes,
  splitTotalLimit,
  unitToSeconds,
} from '../src/app/modules/profiles/rate-limit';

// Inti "keselarasan MikroTik ↔ RADIUS": satu string dipakai dua sisi.
describe('buildRateLimit', () => {
  const base = {
    minUploadKbps: 0,
    minDownloadKbps: 0,
    maxUploadKbps: 10_000,
    maxDownloadKbps: 20_000,
  };

  it('hanya max + priority bila tanpa burst dan min', () => {
    expect(buildRateLimit(base)).toBe('10000k/20000k 1');
  });

  it('menulis burst, threshold, dan burst-time berurutan', () => {
    const value = buildRateLimit({
      ...base,
      burstEnabled: true,
      burstUploadKbps: 12_000,
      burstDownloadKbps: 24_000,
      burstThresholdUploadKbps: 8_000,
      burstThresholdDownloadKbps: 16_000,
      burstTimeSec: 8,
      priority: 5,
    });
    expect(value).toBe('10000k/20000k 12000k/24000k 8000k/16000k 8/8 5');
  });

  it('melengkapi nilai burst yang kosong dengan nilai wajar, bukan bagian kosong', () => {
    const value = buildRateLimit({ ...base, burstEnabled: true });
    // Burst = max, threshold 75% dari max, time 8 detik.
    expect(value).toBe('10000k/20000k 10000k/20000k 7500k/15000k 8/8 1');
    expect(value).not.toContain('  ');
  });

  it('menambahkan min-rate di posisi terakhir', () => {
    const value = buildRateLimit({ ...base, minUploadKbps: 1_000, minDownloadKbps: 2_000 });
    expect(value).toBe('10000k/20000k 1 1000k/2000k');
  });
});

describe('parseRate / parseRateLimit', () => {
  it('mengubah satuan MikroTik ke Kbps (basis 1000)', () => {
    expect(parseRate('10M')).toBe(10_000);
    expect(parseRate('512k')).toBe(512);
    expect(parseRate('1G')).toBe(1_000_000);
    expect(parseRate('1000')).toBe(1000);
    expect(parseRate('')).toBeNull();
  });

  it('membaca kembali string profil asli dari MikroTik', () => {
    // Diambil dari /ip/hotspot/user/profile di perangkat nyata.
    const parsed = parseRateLimit('4210k/4520k 4520k/5032k 3240k/4210k 40/40 8');
    expect(parsed.maxUploadKbps).toBe(4210);
    expect(parsed.maxDownloadKbps).toBe(4520);
    expect(parsed.burstUploadKbps).toBe(4520);
    expect(parsed.burstDownloadKbps).toBe(5032);
    expect(parsed.burstThresholdUploadKbps).toBe(3240);
    expect(parsed.burstTimeSec).toBe(40);
    expect(parsed.priority).toBe(8);
  });

  it('bolak-balik build → parse menghasilkan nilai yang sama', () => {
    const spec = {
      minUploadKbps: 1000,
      minDownloadKbps: 2000,
      maxUploadKbps: 10_000,
      maxDownloadKbps: 20_000,
      burstEnabled: true,
      burstUploadKbps: 12_000,
      burstDownloadKbps: 24_000,
      burstThresholdUploadKbps: 8_000,
      burstThresholdDownloadKbps: 16_000,
      burstTimeSec: 8,
      priority: 5,
    };
    const parsed = parseRateLimit(buildRateLimit(spec));
    expect(parsed.maxUploadKbps).toBe(10_000);
    expect(parsed.maxDownloadKbps).toBe(20_000);
    expect(parsed.burstUploadKbps).toBe(12_000);
    expect(parsed.burstThresholdDownloadKbps).toBe(16_000);
    expect(parsed.burstTimeSec).toBe(8);
    expect(parsed.priority).toBe(5);
    expect(parsed.minUploadKbps).toBe(1000);
    expect(parsed.minDownloadKbps).toBe(2000);
  });

  it('string kosong menghasilkan semua null, bukan crash', () => {
    const parsed = parseRateLimit(null);
    expect(parsed.maxUploadKbps).toBeNull();
    expect(parsed.priority).toBeNull();
  });
});

describe('konversi waktu dan kuota', () => {
  it('unitToSeconds mengikuti satuan profil', () => {
    expect(unitToSeconds(5, 'hour')).toBe(18_000);
    expect(unitToSeconds(2, 'day')).toBe(172_800);
    expect(unitToSeconds(30, 'minute')).toBe(1_800);
    expect(unitToSeconds(1, 'month')).toBe(2_592_000);
  });

  it('quotaToBytes memakai basis 1000 seperti penjualan kuota ISP', () => {
    expect(quotaToBytes(10, 'GB')).toBe(10_000_000_000);
    expect(quotaToBytes(500, 'MB')).toBe(500_000_000);
  });

  it('splitTotalLimit memecah kuota besar ke limit + gigawords', () => {
    // 10 GB = 10e9 byte; 2 gigaword = 8.589.934.592, sisanya masuk `limit`.
    expect(splitTotalLimit(10_000_000_000)).toEqual({
      limit: 10_000_000_000 - 2 * 4_294_967_296,
      gigawords: 2,
    });
    expect(splitTotalLimit(1_000_000)).toEqual({ limit: 1_000_000, gigawords: 0 });
  });
});

describe('buildLoginTime', () => {
  it('tanpa batas hari menghasilkan Al', () => {
    expect(buildLoginTime(null, '08:00', '17:00')).toBe('Al0800-1700');
    expect(buildLoginTime([], '08:00', '17:00')).toBe('Al0800-1700');
  });

  it('Senin-Jumat menjadi Wk', () => {
    expect(buildLoginTime(['mon', 'tue', 'wed', 'thu', 'fri'], '08:00', '17:00')).toBe(
      'Wk0800-1700',
    );
  });

  it('Sabtu dan Minggu digabung dengan pipa', () => {
    expect(buildLoginTime(['sat', 'sun'], '06:00', '12:00')).toBe('Sa|Su0600-1200');
  });

  it('hari terpilih sebagian ditulis apa adanya', () => {
    expect(buildLoginTime(['mon', 'wed'], '09:30', '15:45')).toBe('Mo|We0930-1545');
  });

  it('jam tidak lengkap berarti tanpa batas jam', () => {
    expect(buildLoginTime(['mon'], '08:00', null)).toBeNull();
    expect(buildLoginTime(['mon'], null, '17:00')).toBeNull();
  });
});

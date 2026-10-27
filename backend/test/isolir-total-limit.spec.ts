import { describe, expect, it } from 'vitest';
import {
  BLOCK_MESSAGE,
  freeRadiusDate,
  totalQuotaLimit,
  totalTimeLimit,
} from '../src/app/modules/freeradius/radius-enforcement.service';
import { cidrRange, ipToInt } from '../src/app/modules/freeradius/isolir.service';

// Limitasi = TOTAL kumulatif, diambil dari profil GRUP (bukan per akun).
// Hotspot memakai timebase/quotabase; PPP memakai time_limit_seconds/bytes.

describe('totalTimeLimit', () => {
  it('membaca batas hotspot dari timebase', () => {
    expect(totalTimeLimit({ profile_type: 'hotspot', hotspot_seconds: 21600 })).toBe(21600);
  });

  it('membaca batas PPP dari kolom detik', () => {
    expect(totalTimeLimit({ profile_type: 'ppp', ppp_seconds: 7200 })).toBe(7200);
  });

  it('mengabaikan batas tipe lain', () => {
    // Akun PPP tidak boleh memakai angka timebase hotspot, dan sebaliknya.
    expect(totalTimeLimit({ profile_type: 'ppp', hotspot_seconds: 21600 })).toBeNull();
    expect(totalTimeLimit({ profile_type: 'hotspot', ppp_seconds: 7200 })).toBeNull();
  });

  it('nol atau kosong berarti tanpa batas', () => {
    expect(totalTimeLimit({ profile_type: 'ppp', ppp_seconds: 0 })).toBeNull();
    expect(totalTimeLimit({ profile_type: 'ppp', ppp_seconds: null })).toBeNull();
  });
});

describe('totalQuotaLimit', () => {
  it('membaca batas kuota sesuai tipe', () => {
    expect(totalQuotaLimit({ profile_type: 'hotspot', hotspot_bytes: 5_000_000_000 })).toBe(5_000_000_000);
    expect(totalQuotaLimit({ profile_type: 'ppp', ppp_bytes: 1_000_000_000 })).toBe(1_000_000_000);
    expect(totalQuotaLimit({ profile_type: 'ppp', hotspot_bytes: 5_000_000_000 })).toBeNull();
  });
});

describe('BLOCK_MESSAGE', () => {
  it('memakai kalimat yang diminta untuk hotspot', () => {
    expect(BLOCK_MESSAGE.time).toBe('Waktu online habis');
    expect(BLOCK_MESSAGE.validity).toBe('User expired');
    expect(BLOCK_MESSAGE.quota).toBe('Kuota habis');
  });
});

describe('freeRadiusDate', () => {
  it('format tanggal Expiration FreeRADIUS', () => {
    expect(freeRadiusDate(new Date('2026-10-26T15:04:05'))).toBe('26 Okt 2026 15:04:05');
  });
});

describe('cidrRange (isolir 10.127.0.0/18)', () => {
  it('menghitung batas bawah dan atas /18', () => {
    const range = cidrRange('10.127.0.0/18');
    expect(range).not.toBeNull();
    expect(range!.first).toBe(ipToInt('10.127.0.0'));
    // 10.127.0.0/18 berakhir di 10.127.63.255
    expect(range!.last).toBe(ipToInt('10.127.63.255'));
  });

  it('pool yang dipakai panel berada di dalam CIDR', () => {
    const range = cidrRange('10.127.0.0/18')!;
    for (const ip of ['10.127.0.1', '10.127.0.2', '10.127.63.254']) {
      const value = ipToInt(ip)!;
      expect(value).toBeGreaterThanOrEqual(range.first);
      expect(value).toBeLessThanOrEqual(range.last);
    }
  });

  it('alamat di luar CIDR terdeteksi', () => {
    const range = cidrRange('10.127.0.0/18')!;
    expect(ipToInt('10.127.64.1')!).toBeGreaterThan(range.last);
    expect(ipToInt('10.126.255.254')!).toBeLessThan(range.first);
  });

  it('menolak CIDR ngawur', () => {
    expect(cidrRange('10.127.0.0')).toBeNull();
    expect(cidrRange('10.127.0.0/33')).toBeNull();
    expect(cidrRange('999.1.1.1/24')).toBeNull();
  });
});

describe('ipToInt', () => {
  it('mengurutkan alamat secara numerik', () => {
    expect(ipToInt('10.127.0.2')!).toBeLessThan(ipToInt('10.127.0.10')!);
  });

  it('menolak bentuk tidak valid', () => {
    for (const bad of ['', '10.127.0', '10.127.0.256', 'a.b.c.d']) {
      expect(ipToInt(bad)).toBeNull();
    }
  });
});

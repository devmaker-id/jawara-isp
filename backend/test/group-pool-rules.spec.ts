import { describe, expect, it } from 'vitest';
import { ipToInt, poolNameFor } from '../src/app/modules/profiles/profiles.service';

// Aturan pool grup:
//  - gateway PPP tidak boleh berada di dalam rentang pool (kalau ikut, alamat
//    gateway bisa dibagikan ke pelanggan);
//  - nama pool harus deterministik supaya penghapusan menunjuk objek yang sama.
describe('ipToInt', () => {
  it('mengurutkan alamat sesuai nilai numerik', () => {
    expect(ipToInt('172.10.0.1')).toBeLessThan(ipToInt('172.10.0.2'));
    expect(ipToInt('172.10.0.254')).toBeGreaterThan(ipToInt('172.10.0.9'));
    expect(ipToInt('10.0.0.0')).toBeLessThan(ipToInt('10.0.0.1'));
  });

  it('menolak bentuk yang bukan IPv4', () => {
    for (const bad of ['', '172.10.0', '172.10.0.256', '172.10.0.1.2', 'a.b.c.d', '172.10.0.-1']) {
      expect(ipToInt(bad)).toBeNull();
    }
  });
});

describe('poolNameFor', () => {
  it('memberi awalan jw- dan membuang karakter yang tidak sah', () => {
    expect(poolNameFor('RUMAHAN')).toBe('jw-RUMAHAN');
    expect(poolNameFor('hs warkop 2')).toBe('jw-hs-warkop-2');
    expect(poolNameFor('  pak/budi  ')).toBe('jw-pak-budi');
  });

  it('membatasi 64 karakter seperti batas nama objek RouterOS', () => {
    expect(poolNameFor('a'.repeat(200)).length).toBe(64);
  });

  it('tetap menghasilkan nama walau nama grup kosong', () => {
    expect(poolNameFor('   ')).toBe('jw-pool');
  });
});

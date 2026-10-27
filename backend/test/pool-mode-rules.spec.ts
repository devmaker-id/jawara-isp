import { describe, expect, it } from 'vitest';
import { assertPoolSource } from '../src/app/modules/profiles/profiles.service';

// Aturan mode pool per tipe grup:
//   group-pool   GROUP ONLY (Hotspot Only) — khusus hotspot, tanpa rentang,
//                karena RADIUS memakai profil hotspot bawaan router.
//   router-pool  IP pool MikroTik (per router) — khusus PPP, wajib rentang dan
//                IP local gateway di luar rentang.
const err = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

describe('GROUP ONLY (Hotspot Only) = group-pool', () => {
  it('hotspot tanpa rentang pool diterima', () => {
    // Inilah kasus yang dulu salah ditolak: "Mode group-pool wajib mengisi
    // IP awal dan IP akhir."
    expect(
      err(() => assertPoolSource({ mode: 'group-pool', type: 'hotspot' })),
    ).toBeNull();
  });

  it('hotspot dengan rentang terisi tetap diterima (diabaikan)', () => {
    expect(
      err(() =>
        assertPoolSource({
          mode: 'group-pool',
          type: 'hotspot',
          rangeStart: '172.16.10.2',
          rangeEnd: '172.16.10.254',
        }),
      ),
    ).toBeNull();
  });

  it('ditolak untuk tipe PPP', () => {
    const message = err(() => assertPoolSource({ mode: 'group-pool', type: 'ppp' }));
    expect(message).toContain('hanya untuk grup bertipe hotspot');
  });
});

describe('IP pool MikroTik per router = router-pool', () => {
  it('PPP dengan rentang dan gateway di luar rentang diterima', () => {
    expect(
      err(() =>
        assertPoolSource({
          mode: 'router-pool',
          type: 'ppp',
          localAddress: '172.10.0.1',
          rangeStart: '172.10.0.2',
          rangeEnd: '172.10.0.254',
        }),
      ),
    ).toBeNull();
  });

  it('ditolak untuk tipe hotspot', () => {
    const message = err(() =>
      assertPoolSource({
        mode: 'router-pool',
        type: 'hotspot',
        localAddress: '172.10.0.1',
        rangeStart: '172.10.0.2',
        rangeEnd: '172.10.0.254',
      }),
    );
    expect(message).toContain('hanya untuk grup bertipe PPP');
  });

  it('wajib rentang, wajib IP local, dan gateway tidak boleh di dalam rentang', () => {
    expect(
      err(() => assertPoolSource({ mode: 'router-pool', type: 'ppp', localAddress: '172.10.0.1' })),
    ).toContain('wajib mengisi IP awal dan IP akhir');

    expect(
      err(() =>
        assertPoolSource({
          mode: 'router-pool',
          type: 'ppp',
          rangeStart: '172.10.0.2',
          rangeEnd: '172.10.0.254',
        }),
      ),
    ).toContain('wajib mengisi IP local');

    expect(
      err(() =>
        assertPoolSource({
          mode: 'router-pool',
          type: 'ppp',
          localAddress: '172.10.0.10',
          rangeStart: '172.10.0.2',
          rangeEnd: '172.10.0.254',
        }),
      ),
    ).toContain('berada di dalam rentang pool');

    expect(
      err(() =>
        assertPoolSource({
          mode: 'router-pool',
          type: 'ppp',
          localAddress: '172.10.0.1',
          rangeStart: '172.10.0.254',
          rangeEnd: '172.10.0.2',
        }),
      ),
    ).toContain('lebih kecil atau sama dengan');
  });
});

describe('mode lain', () => {
  it('mikrotik-pool wajib menyebut nama pool, untuk kedua tipe', () => {
    for (const type of ['hotspot', 'ppp'] as const) {
      expect(err(() => assertPoolSource({ mode: 'mikrotik-pool', type }))).toContain(
        'wajib menyebutkan nama IP pool',
      );
      expect(
        err(() => assertPoolSource({ mode: 'mikrotik-pool', type, poolName: 'PPP-POOL' })),
      ).toBeNull();
    }
  });

  it('sql-ippool tidak butuh apa pun', () => {
    expect(err(() => assertPoolSource({ mode: 'sql-ippool', type: 'hotspot' }))).toBeNull();
    expect(err(() => assertPoolSource({ mode: 'sql-ippool', type: 'ppp' }))).toBeNull();
  });
});

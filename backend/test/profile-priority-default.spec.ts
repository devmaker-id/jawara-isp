import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ProfilesService } from '../src/app/modules/profiles/profiles.service';

// Prioritas queue MikroTik memakai skala 1 (tertinggi) sampai 8 (terendah).
// Profil layanan baru harus mulai di 8 supaya pelanggan biasa tidak menyerobot
// antrean; operator tetap bisa memilih angka lain lewat form.
function service() {
  return new ProfilesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function normalize(type: 'hotspot' | 'ppp', dto: Record<string, unknown>) {
  const svc = service() as unknown as {
    normalizeProfile: (t: string, d: unknown, g: unknown) => Record<string, unknown>;
  };
  return svc.normalizeProfile(type, dto, {
    id: 1,
    type,
    pool_mode: 'router-pool',
    name: 'Grup Uji',
  });
}

const baseDto = {
  name: 'PROFIL-UJI',
  group_id: 1,
  shared_users: 1,
  validity_value: 0,
  validity_unit: 'day',
};

describe('default prioritas profil layanan', () => {
  it('profil hotspot tanpa priority memakai 8', () => {
    expect(normalize('hotspot', baseDto).priority).toBe(8);
  });

  it('profil PPP tanpa priority memakai 8', () => {
    expect(normalize('ppp', baseDto).priority).toBe(8);
  });

  it('priority eksplisit tidak ditimpa', () => {
    expect(normalize('hotspot', { ...baseDto, priority: 3 }).priority).toBe(3);
    expect(normalize('ppp', { ...baseDto, priority: 1 }).priority).toBe(1);
  });
});

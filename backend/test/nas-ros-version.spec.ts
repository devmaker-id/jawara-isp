import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateNasDto, UpdateNasDto } from '../src/app/modules/freeradius/dto/radius.dto';
import {
  NasRow,
  ROS_VERSIONS,
  requireMessageAuth,
  toNas,
} from '../src/app/modules/freeradius/models/radius.model';

// ROS 7.15+ mewajibkan Message-Authenticator pada Access-Accept/Challenge/Reject
// (`require-message-auth`, default yes-for-request-resp); ROS 6 tidak memintanya.
// Jadi `nas.require_ma` adalah turunan dari `nas.ros_version`, bukan isian kedua.
describe('NAS ros_version', () => {
  const row = (over: Partial<NasRow> = {}): NasRow => ({
    id: 1,
    nasname: '192.168.100.254',
    shortname: 'core',
    type: 'mikrotik',
    ports: 1812,
    server: '',
    community: null,
    description: 'Core',
    secret: 'rahasia-rahasia',
    require_ma: 0,
    ros_version: '6',
    ...over,
  });

  it('require_ma diturunkan dari versi: 7 → 1, 6 → 0', () => {
    expect(requireMessageAuth('7')).toBe(1);
    expect(requireMessageAuth('6')).toBe(0);
  });

  it('hanya dua versi yang dikenal', () => {
    expect([...ROS_VERSIONS]).toEqual(['6', '7']);
  });

  it('toNas membawa ros_version dan tidak membocorkan secret', () => {
    const nas = toNas(row({ ros_version: '7' }));
    expect(nas.ros_version).toBe('7');
    expect(Object.prototype.hasOwnProperty.call(nas, 'secret')).toBe(false);
  });

  it('toNas menormalkan nilai asing menjadi 6, bukan undefined', () => {
    const nas = toNas(row({ ros_version: '9' as unknown as '6' }));
    expect(nas.ros_version).toBe('6');
  });

  it('DTO menolak versi selain 6 dan 7', () => {
    const base = { nasname: '10.0.0.1', secret: 'rahasia-rahasia' };
    const errs = (dto: '8' | '6' | '7' | undefined, cls: typeof CreateNasDto | typeof UpdateNasDto) =>
      validateSync(plainToInstance(cls, { ...base, ros_version: dto })).filter((e) =>
        Object.keys(e.constraints ?? {}).length > 0,
      );

    expect(errs(undefined, CreateNasDto)).toHaveLength(0);
    expect(errs('6', CreateNasDto)).toHaveLength(0);
    expect(errs('7', CreateNasDto)).toHaveLength(0);
    expect(errs('8', CreateNasDto).length).toBeGreaterThan(0);
    expect(errs('7', UpdateNasDto)).toHaveLength(0);
    expect(errs('8', UpdateNasDto).length).toBeGreaterThan(0);
  });
});

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { Role, RoleValues } from '../src/app/config/config.service';
import { CreateUserDto } from '../src/app/modules/admin/dto/user.dto';
import { ROLES, isKnownRole } from '../src/app/modules/auth/roles.decorator';

// Regresi untuk bug `export const Role = Object.freeze` (tanpa argumen):
// nilainya adalah referensi fungsi, sehingga @IsEnum(Role) menolak semua role
// yang sebenarnya valid.
describe('definisi Role', () => {
  it('Role adalah objek enum, bukan fungsi', () => {
    expect(typeof Role).toBe('object');
    expect(Role.ADMIN).toBe('admin');
    expect(Role.OPERATOR).toBe('operator');
    expect(Role.RESSELER).toBe('resseler');
  });

  it('RoleValues tetap kompatibel dengan import lama', () => {
    expect(RoleValues).toBe(Role);
  });

  it('ROLES pada RBAC diturunkan dari RoleValues (tidak ada daftar ganda)', () => {
    expect([...ROLES]).toEqual([Role.ADMIN, Role.OPERATOR, Role.RESSELER]);
  });

  it('isKnownRole menerima role sah dan menolak yang lain', () => {
    for (const role of ROLES) {
      expect(isKnownRole(role)).toBe(true);
    }
    for (const role of ['superadmin', 'Admin', '', null, undefined, 1]) {
      expect(isKnownRole(role)).toBe(false);
    }
  });

  it('@IsEnum(Role) menerima role sah dan menolak role asing', () => {
    const validate = (role: string) =>
      validateSync(
        plainToInstance(CreateUserDto, {
          name: 'Uji Role',
          email: 'role@example.test',
          password: 'rahasia123',
          role,
        }),
      );

    expect(validate('admin')).toHaveLength(0);
    expect(validate('operator')).toHaveLength(0);
    expect(validate('resseler')).toHaveLength(0);
    expect(validate('superadmin').length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../src/app/modules/auth/roles.decorator';
import { PERMISSION_KEY } from '../src/app/modules/permissions/permission.guard';
import { ProfilesController } from '../src/app/modules/profiles/profiles.controller';
import { OltController } from '../src/app/modules/olt/olt.controller';
import { CustomersController } from '../src/app/modules/customers/customers.controller';
import { RadiusController } from '../src/app/modules/freeradius/radius.controller';
import { MikrotikController } from '../src/app/modules/mikrotik/mikrotik.controller';
import { AdminController } from '../src/app/modules/admin/admin.controller';
import { PermissionsController } from '../src/app/modules/permissions/permissions.controller';
import { ToolsController } from '../src/app/modules/tools/tools.controller';

/**
 * Penjaga konsistensi dua lapis akses.
 *
 * Panel memakai dua gerbang: `@Roles()` (role apa yang boleh masuk) dan
 * `@RequirePermission()` (izin per akun). Bug yang pernah terjadi: sebuah
 * endpoint hanya dijaga `@Roles('admin','operator')` padahal matriks izin
 * memberi `*.view` ke reseller — reseller jadi ditolak 403 di halaman yang
 * menunya justru dia lihat.
 *
 * Aturannya: setiap endpoint yang menyebut satu izin WAJIB mengizinkan semua
 * role yang secara default memegang izin itu. Kalau tidak, matriks izin di
 * menu Pengguna tidak ada artinya.
 */

// Nilai default dari migrasi 019 (matriks izin per role).
const RESELLER_DEFAULTS = new Set([
  'customer.view',
  'customer.create',
  'customer.update',
  'profile.view',
  'profile.create',
  'profile.update',
  'group.view',
  'bandwidth.view',
  'voucher.view',
  'voucher.generate',
  'voucher.print',
  'invoice.view',
  'payment.view',
  'report.view',
  // OLT sengaja TIDAK termasuk: perangkat jaringan akses hanya untuk
  // admin & operator (migrasi 025).
]);

const OPERATOR_DEFAULTS = new Set([
  ...RESELLER_DEFAULTS,
  'voucher.delete',
  'group.create',
  'group.update',
  'bandwidth.create',
  'bandwidth.update',
  'nas.view',
  'nas.create',
  'nas.update',
  'radius.view',
  'isolir.view',
  'isolir.update',
  'device.view',
  'device.create',
  'device.update',
  'customer.delete',
  'invoice.create',
  'invoice.update',
  'payment.create',
  'olt.create',
  'olt.update',
  'olt.sync',
]);

const controllers = [
  ['profiles', ProfilesController],
  ['olt', OltController],
  ['customers', CustomersController],
  ['freeradius', RadiusController],
  ['mikrotik', MikrotikController],
  ['admin', AdminController],
  ['permissions', PermissionsController],
  ['tools', ToolsController],
] as const;


/**
 * Nama method pada prototype controller.
 *
 * Dekorator `@Get/@Roles` menempelkan metadata pada FUNGSI method, jadi yang
 * dibaca harus `Controller.prototype`, bukan kelasnya — `Object.getPrototypeOf`
 * pada sebuah kelas mengembalikan `Function.prototype` dan tidak berisi method
 * apa pun (kesalahan ini membuat pemeriksaan selalu kosong).
 */
const handlerNames = (prototype: object): string[] =>
  Object.getOwnPropertyNames(prototype).filter(
    (name) => name !== 'constructor' && typeof (prototype as Record<string, unknown>)[name] === 'function',
  );

describe('modul OLT hanya untuk admin & operator', () => {
  it('tidak ada endpoint OLT yang mengizinkan reseller', () => {
    const prototype = OltController.prototype as unknown as Record<string, unknown>;
    const bocor = handlerNames(prototype).filter((handler) => {
      const fn = prototype[handler] as object | undefined;
      const roles = (Reflect.getMetadata(ROLES_KEY, fn ?? {}) ?? []) as string[];
      return roles.includes('resseler');
    });
    expect(bocor).toEqual([]);
  });
});

describe('kesesuaian @Roles dengan matriks izin', () => {
  for (const [label, Controller] of controllers) {
    it(`${label}: role yang memegang izin tidak dicekal @Roles`, () => {
      const prototype = Controller.prototype as unknown as Record<string, unknown>;
      // Role di level kelas juga berlaku (mis. @Roles('admin') pada controller).
      const violations: string[] = [];

      for (const handler of handlerNames(prototype)) {
        const fn = prototype[handler] as object | undefined;
        if (!fn) continue;
        const permission = Reflect.getMetadata(PERMISSION_KEY, fn) as string | undefined;
        if (!permission) continue;

        const roles = (Reflect.getMetadata(ROLES_KEY, fn) ?? []) as string[];
        if (roles.length === 0) continue;

        if (RESELLER_DEFAULTS.has(permission) && !roles.includes('resseler')) {
          violations.push(`${handler} butuh "${permission}" (reseller punya) tapi role: ${roles.join(',')}`);
        }
        if (OPERATOR_DEFAULTS.has(permission) && !roles.includes('operator')) {
          violations.push(`${handler} butuh "${permission}" (operator punya) tapi role: ${roles.join(',')}`);
        }
        if (!roles.includes('admin')) {
          violations.push(`${handler} tidak mengizinkan admin`);
        }
      }

      expect(violations).toEqual([]);
    });
  }
});
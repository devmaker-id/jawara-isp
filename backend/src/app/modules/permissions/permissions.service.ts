import { Injectable, Logger } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';

/**
 * Katalog izin + izin efektif per akun.
 *
 * Efektif = `user_permissions` bila ada barisnya, kalau tidak `role_permissions`.
 * Dengan begitu /pengguna cukup menampilkan centang, dan role hanya nilai awal.
 *
 * Admin tidak dibatasi (bypass di guard), sesuai keputusan pemilik panel. Namun
 * katalognya tetap ditulis untuk admin supaya matriks di UI tidak kosong.
 */

export type AppRole = 'admin' | 'operator' | 'resseler';

export interface PermissionRow {
  code: string;
  label: string;
  module: string;
  sort: number;
}

export interface EffectivePermission {
  code: string;
  label: string;
  module: string;
  /** Nilai yang berlaku sekarang. */
  allowed: boolean;
  /** Dari mana nilai itu datang: role atau penimpaan per akun. */
  source: 'role' | 'user';
}

/** Urutan modul menentukan urutan kelompok di UI. */
export const MODULE_ORDER = [
  'customer',
  'profile',
  'group',
  'bandwidth',
  'voucher',
  'device',
  'nas',
  'radius',
  'isolir',
  'invoice',
  'payment',
  'report',
  'tools',
  'user',
] as const;

export const MODULE_LABEL: Record<string, string> = {
  customer: 'Pelanggan',
  profile: 'Profil layanan',
  group: 'Group profile',
  bandwidth: 'Bandwidth',
  voucher: 'Voucher',
  device: 'Perangkat MikroTik',
  nas: 'NAS RADIUS',
  radius: 'FreeRADIUS',
  isolir: 'Profil isolir',
  invoice: 'Tagihan',
  payment: 'Pembayaran',
  report: 'Laporan',
  tools: 'Tools database',
  user: 'Pengguna & hak akses',
};

/** Cache singkat: guard memanggil ini pada setiap request. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly cache = new Map<number, { at: number; codes: Set<string> }>();

  constructor(private readonly db: DatabaseService) {}

  /** Buang cache satu akun (dipanggil setelah /pengguna menyimpan). */
  invalidate(userId?: number): void {
    if (userId === undefined) this.cache.clear();
    else this.cache.delete(userId);
  }

  async catalog(): Promise<PermissionRow[]> {
    const rows = await this.db.query<RowDataPacket>(
      'SELECT code, label, module, sort FROM permissions ORDER BY module, sort',
    );
    return rows.map((row) => ({
      code: String(row.code),
      label: String(row.label),
      module: String(row.module),
      sort: Number(row.sort),
    }));
  }

  /**
   * Kode izin yang benar-benar dimiliki seorang akun.
   *
   * Admin mengembalikan seluruh katalog: guard tidak memeriksanya, tetapi UI
   * dan endpoint lain butuh daftar lengkap agar tidak menampilkan tombol mati.
   */
  async effectiveCodes(userId: number, role: string): Promise<Set<string>> {
    if (role === 'admin') {
      const all = await this.db.query<RowDataPacket>('SELECT code FROM permissions');
      return new Set(all.map((row) => String(row.code)));
    }

    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.codes;

    const rows = await this.db.query<RowDataPacket>(
      `SELECT p.code,
              COALESCE(u.allowed, r.allowed, 0) AS allowed
         FROM permissions p
         LEFT JOIN user_permissions u ON u.code = p.code AND u.user_id = ?
         LEFT JOIN role_permissions r ON r.code = p.code AND r.role = ?`,
      [userId, role],
    );
    const codes = new Set(
      rows.filter((row) => Number(row.allowed) === 1).map((row) => String(row.code)),
    );
    this.cache.set(userId, { at: Date.now(), codes });
    return codes;
  }

  async can(userId: number, role: string, code: string): Promise<boolean> {
    if (role === 'admin') return true;
    return (await this.effectiveCodes(userId, role)).has(code);
  }

  /** Izin efektif satu akun, lengkap dengan sumbernya — untuk halaman /pengguna. */
  async effectiveForUser(userId: number, role: string): Promise<EffectivePermission[]> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT p.code, p.label, p.module, p.sort,
              r.allowed AS role_allowed,
              u.allowed AS user_allowed
         FROM permissions p
         LEFT JOIN role_permissions r ON r.code = p.code AND r.role = ?
         LEFT JOIN user_permissions u ON u.code = p.code AND u.user_id = ?
        ORDER BY p.module, p.sort`,
      [role, userId],
    );
    return rows.map((row) => {
      const override = row.user_allowed === null || row.user_allowed === undefined
        ? null
        : Number(row.user_allowed) === 1;
      const fromRole = Number(row.role_allowed ?? 0) === 1;
      return {
        code: String(row.code),
        label: String(row.label),
        module: String(row.module),
        // Admin selalu dianggap punya semua, walau tabelnya tidak diisi.
        allowed: role === 'admin' ? true : (override ?? fromRole),
        source: override === null ? 'role' : 'user',
      };
    });
  }

  /** Matriks awal per role (untuk tombol "kembalikan ke default"). */
  async roleDefaults(role: AppRole): Promise<Set<string>> {
    const rows = await this.db.query<RowDataPacket>(
      'SELECT code FROM role_permissions WHERE role = ? AND allowed = 1',
      [role],
    );
    return new Set(rows.map((row) => String(row.code)));
  }

  /**
   * Ganti seluruh penimpaan satu akun.
   *
   * `codes` = izin yang harus AKTIF. Izin yang sama dengan default role tidak
   * disimpan sebagai baris (agar tombol "kembalikan ke default" tetap berarti);
   * izin yang berbeda dari default disimpan eksplisit — termasuk `allowed = 0`
   * untuk mencabut sesuatu yang sebenarnya diberikan role.
   */
  async setUserPermissions(
    userId: number,
    role: AppRole,
    codes: string[],
    actorId: number,
  ): Promise<{ saved: number; removed: number }> {
    const catalog = new Set((await this.catalog()).map((row) => row.code));
    const unknown = codes.filter((code) => !catalog.has(code));
    if (unknown.length > 0) {
      throw new Error(`Izin tidak dikenal: ${unknown.join(', ')}`);
    }

    const defaults = await this.roleDefaults(role);
    const wanted = new Set(codes);

    // Selisih terhadap default role = yang perlu disimpan sebagai penimpaan.
    const overrides: Array<[string, number]> = [];
    for (const code of catalog) {
      const isWanted = wanted.has(code);
      const isDefault = defaults.has(code);
      if (isWanted !== isDefault) overrides.push([code, isWanted ? 1 : 0]);
    }

    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
      for (const [code, allowed] of overrides) {
        await connection.query(
          'INSERT INTO user_permissions (user_id, code, allowed) VALUES (?, ?, ?)',
          [userId, code, allowed],
        );
      }
      await connection.query(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [
          actorId,
          'USER_PERMISSIONS_SET',
          JSON.stringify({
            target_user_id: userId,
            role,
            granted: codes.length,
            overrides: overrides.length,
            at: new Date().toISOString(),
          }),
          'panel',
        ],
      );
    });

    this.invalidate(userId);
    this.logger.log(`Hak akses akun #${userId} disimpan (${overrides.length} penimpaan).`);
    return { saved: codes.length, removed: overrides.length };
  }

  /** Hapus semua penimpaan: akun kembali mengikuti role-nya. */
  async resetUserPermissions(userId: number, actorId: number): Promise<{ ok: true }> {
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
      await connection.query(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [
          actorId,
          'USER_PERMISSIONS_RESET',
          JSON.stringify({ target_user_id: userId, at: new Date().toISOString() }),
          'panel',
        ],
      );
    });
    this.invalidate(userId);
    return { ok: true };
  }

  /**
   * Akun yang boleh dipilih sebagai PEMILIK data (admin saja yang memilih).
   *
   * Hanya akun aktif: pemilik nonaktif membuat data tidak terlihat siapa pun.
   */
  async assignableOwners(): Promise<Array<{ id: number; name: string; email: string; role: string }>> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT id, name, email, role FROM users
        WHERE is_active = 1 AND role IN ('admin','operator','resseler')
        ORDER BY role, name`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      role: String(row.role),
    }));
  }
}

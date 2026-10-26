import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

// ============================================================================
// Repository untuk Bandwidth, Group Profile, Profile Hotspot/PPP, dan Voucher.
//
// Semua query parameterized. Nama kolom mengikuti migrations/006_service_profiles.sql.
// ============================================================================

export interface BandwidthRow {
  id: number;
  owner_id: number;
  name: string;
  min_upload_kbps: number;
  min_download_kbps: number;
  max_upload_kbps: number;
  max_download_kbps: number;
  burst_enabled: number;
  burst_upload_kbps: number | null;
  burst_download_kbps: number | null;
  burst_threshold_upload_kbps: number | null;
  burst_threshold_download_kbps: number | null;
  burst_time_sec: number | null;
  priority: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface GroupProfileRow {
  id: number;
  owner_id: number;
  router_id: number;
  name: string;
  type: 'hotspot' | 'ppp';
  pool_mode: 'mikrotik-pool' | 'sql-ippool';
  mikrotik_pool_name: string | null;
  dns_primary: string | null;
  dns_secondary: string | null;
  parent_queue: string | null;
  use_router_default: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ServiceProfileRow {
  id: number;
  owner_id: number;
  group_profile_id: number;
  bandwidth_id: number;
  name: string;
  /** Nama grup RADIUS final; bisa "nama#id" bila nama profil bentrok. */
  radius_group: string | null;
  cost_price: number;
  sell_price: number;
  promo_price: number;
  tax_percent: number;
  quota_type?: 'unlimited' | 'limited';
  timebase_value?: number | null;
  timebase_unit?: string | null;
  quotabase_value?: number | null;
  quotabase_unit?: string | null;
  validity_value: number;
  validity_unit: string;
  shared_users: number;
  priority: number;
  login_days: string | null;
  login_start: string | null;
  login_end: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface VoucherRow {
  id: number;
  profile_type: 'hotspot' | 'ppp';
  profile_id: number;
  group_profile_id: number;
  profile_name: string;
  user_type: 'voucher' | 'customer';
  username: string;
  password: string;
  customer_id: number | null;
  /** Diisi dari join customers; null untuk akun voucher. */
  customer_name?: string | null;
  status: 'new-created' | 'ready-to-use' | 'active' | 'expired';
  price: number;
  tax_amount: number;
  first_login_at: string | null;
  expires_at: string | null;
  online_seconds: number;
  quota_used_bytes: number;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

const BANDWIDTH_COLUMNS = `id, owner_id, name, min_upload_kbps, min_download_kbps,
  max_upload_kbps, max_download_kbps, burst_enabled, burst_upload_kbps, burst_download_kbps,
  burst_threshold_upload_kbps, burst_threshold_download_kbps, burst_time_sec, priority,
  created_at, updated_at`;

const GROUP_COLUMNS = `id, owner_id, router_id, name, type, pool_mode, mikrotik_pool_name,
  dns_primary, dns_secondary, parent_queue, use_router_default, created_at, updated_at`;

const PROFILE_BASE = `id, owner_id, group_profile_id, bandwidth_id, name, radius_group, cost_price, sell_price,
  promo_price, tax_percent, validity_value, validity_unit, shared_users, priority,
  login_days, login_start, login_end, is_active, created_at, updated_at`;

// Kolom khusus hotspot yang tidak ada di tabel ppp.
const HOTSPOT_EXTRA = `quota_type, timebase_value, timebase_unit, quotabase_value, quotabase_unit`;

@Injectable()
export class BandwidthRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(ownerId?: number, search?: string): Promise<BandwidthRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (ownerId) {
      where.push('owner_id = ?');
      params.push(ownerId);
    }
    if (search) {
      where.push('name LIKE ?');
      params.push(`%${search}%`);
    }
    return this.db.query<BandwidthRow>(
      `SELECT ${BANDWIDTH_COLUMNS} FROM bandwidth_profiles
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY name`,
      params,
    );
  }

  async findById(id: number): Promise<BandwidthRow | null> {
    const rows = await this.db.query<BandwidthRow>(
      `SELECT ${BANDWIDTH_COLUMNS} FROM bandwidth_profiles WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByName(ownerId: number, name: string, exceptId?: number): Promise<BandwidthRow | null> {
    const rows = await this.db.query<BandwidthRow>(
      `SELECT ${BANDWIDTH_COLUMNS} FROM bandwidth_profiles
        WHERE owner_id = ? AND name = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`,
      exceptId ? [ownerId, name, exceptId] : [ownerId, name],
    );
    return rows[0] ?? null;
  }

  async create(data: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(data);
    const result = await this.db.execute(
      `INSERT INTO bandwidth_profiles (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(data),
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<void> {
    const columns = Object.keys(data);
    if (columns.length === 0) return;
    await this.db.execute(
      `UPDATE bandwidth_profiles SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(data), id],
    );
  }

  async remove(id: number): Promise<void> {
    await this.db.execute('DELETE FROM bandwidth_profiles WHERE id = ?', [id]);
  }

  // Berapa profil yang memakai bandwidth ini (mencegah hapus data terpakai).
  async usageCount(id: number): Promise<number> {
    const rows = await this.db.query<{ total: number }>(
      `SELECT (SELECT COUNT(*) FROM hotspot_profiles WHERE bandwidth_id = ?) +
              (SELECT COUNT(*) FROM ppp_profiles WHERE bandwidth_id = ?) AS total`,
      [id, id],
    );
    return Number(rows[0]?.total ?? 0);
  }
}

@Injectable()
export class GroupProfileRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(ownerId?: number, type?: string, search?: string): Promise<GroupProfileRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (ownerId) {
      where.push('owner_id = ?');
      params.push(ownerId);
    }
    if (type === 'hotspot' || type === 'ppp') {
      where.push('type = ?');
      params.push(type);
    }
    if (search) {
      where.push('name LIKE ?');
      params.push(`%${search}%`);
    }
    return this.db.query<GroupProfileRow>(
      `SELECT ${GROUP_COLUMNS} FROM group_profiles
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`,
      params,
    );
  }

  async findById(id: number): Promise<GroupProfileRow | null> {
    const rows = await this.db.query<GroupProfileRow>(
      `SELECT ${GROUP_COLUMNS} FROM group_profiles WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByName(
    ownerId: number,
    type: string,
    name: string,
    exceptId?: number,
  ): Promise<GroupProfileRow | null> {
    const rows = await this.db.query<GroupProfileRow>(
      `SELECT ${GROUP_COLUMNS} FROM group_profiles
        WHERE owner_id = ? AND type = ? AND name = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`,
      exceptId ? [ownerId, type, name, exceptId] : [ownerId, type, name],
    );
    return rows[0] ?? null;
  }

  async create(data: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(data);
    const result = await this.db.execute(
      `INSERT INTO group_profiles (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(data),
    );
    return result.insertId;
  }

  async update(id: number, data: Record<string, unknown>): Promise<void> {
    const columns = Object.keys(data);
    if (columns.length === 0) return;
    await this.db.execute(
      `UPDATE group_profiles SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(data), id],
    );
  }

  async remove(id: number): Promise<void> {
    await this.db.execute('DELETE FROM group_profiles WHERE id = ?', [id]);
  }

  async usageCount(id: number): Promise<number> {
    const rows = await this.db.query<{ total: number }>(
      `SELECT (SELECT COUNT(*) FROM hotspot_profiles WHERE group_profile_id = ?) +
              (SELECT COUNT(*) FROM ppp_profiles WHERE group_profile_id = ?) +
              (SELECT COUNT(*) FROM radius_vouchers WHERE group_profile_id = ?) AS total`,
      [id, id, id],
    );
    return Number(rows[0]?.total ?? 0);
  }
}

@Injectable()
export class ServiceProfileRepository {
  constructor(private readonly db: DatabaseService) {}

  private table(type: 'hotspot' | 'ppp'): string {
    return type === 'hotspot' ? 'hotspot_profiles' : 'ppp_profiles';
  }

  private columns(type: 'hotspot' | 'ppp'): string {
    return type === 'hotspot' ? `${PROFILE_BASE}, ${HOTSPOT_EXTRA}` : PROFILE_BASE;
  }

  async list(type: 'hotspot' | 'ppp', ownerId?: number, search?: string): Promise<ServiceProfileRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (ownerId) {
      where.push('owner_id = ?');
      params.push(ownerId);
    }
    if (search) {
      where.push('name LIKE ?');
      params.push(`%${search}%`);
    }
    return this.db.query<ServiceProfileRow>(
      `SELECT ${this.columns(type)} FROM ${this.table(type)}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`,
      params,
    );
  }

  async findById(type: 'hotspot' | 'ppp', id: number): Promise<ServiceProfileRow | null> {
    const rows = await this.db.query<ServiceProfileRow>(
      `SELECT ${this.columns(type)} FROM ${this.table(type)} WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByName(
    type: 'hotspot' | 'ppp',
    ownerId: number,
    name: string,
    exceptId?: number,
  ): Promise<ServiceProfileRow | null> {
    const rows = await this.db.query<ServiceProfileRow>(
      `SELECT ${this.columns(type)} FROM ${this.table(type)}
        WHERE owner_id = ? AND name = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`,
      exceptId ? [ownerId, name, exceptId] : [ownerId, name],
    );
    return rows[0] ?? null;
  }

  async create(type: 'hotspot' | 'ppp', data: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(data);
    const result = await this.db.execute(
      `INSERT INTO ${this.table(type)} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(data),
    );
    return result.insertId;
  }

  async update(type: 'hotspot' | 'ppp', id: number, data: Record<string, unknown>): Promise<void> {
    const columns = Object.keys(data);
    if (columns.length === 0) return;
    await this.db.execute(
      `UPDATE ${this.table(type)} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(data), id],
    );
  }

  async remove(type: 'hotspot' | 'ppp', id: number): Promise<void> {
    await this.db.execute(`DELETE FROM ${this.table(type)} WHERE id = ?`, [id]);
  }

  async voucherCount(type: 'hotspot' | 'ppp', id: number): Promise<number> {
    const rows = await this.db.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM radius_vouchers WHERE profile_type = ? AND profile_id = ?',
      [type, id],
    );
    return Number(rows[0]?.total ?? 0);
  }
}

@Injectable()
export class VoucherRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(filters: {
    profileType?: string;
    profileId?: number;
    status?: string;
    userType?: string;
    search?: string;
    createdBy?: number;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): Promise<VoucherRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.userType === 'voucher' || filters.userType === 'member') {
      where.push('v.user_type = ?');
      params.push(filters.userType);
    }
    if (filters.profileType === 'hotspot' || filters.profileType === 'ppp') {
      where.push('v.profile_type = ?');
      params.push(filters.profileType);
    }
    if (filters.profileId) {
      where.push('v.profile_id = ?');
      params.push(filters.profileId);
    }
    if (filters.status) {
      where.push('v.status = ?');
      params.push(filters.status);
    }
    if (filters.search) {
      where.push('(v.username LIKE ? OR v.profile_name LIKE ? OR c.name LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.createdBy) {
      where.push('v.created_by = ?');
      params.push(filters.createdBy);
    }
    // Batas tanggal inklusif: date_to mencakup seluruh hari tersebut.
    if (filters.dateFrom) {
      where.push('v.created_at >= ?');
      params.push(`${filters.dateFrom} 00:00:00`);
    }
    if (filters.dateTo) {
      where.push('v.created_at <= ?');
      params.push(`${filters.dateTo} 23:59:59`);
    }
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
    return this.db.query<VoucherRow>(
      `SELECT v.*, c.name AS customer_name
         FROM radius_vouchers v
         LEFT JOIN customers c ON c.id = v.customer_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY v.id DESC LIMIT ?`,
      [...params, limit],
    );
  }

  async findById(id: number): Promise<VoucherRow | null> {
    const rows = await this.db.query<VoucherRow>(
      `SELECT v.*, c.name AS customer_name
         FROM radius_vouchers v
         LEFT JOIN customers c ON c.id = v.customer_id
        WHERE v.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<VoucherRow | null> {
    const rows = await this.db.query<VoucherRow>(
      'SELECT * FROM radius_vouchers WHERE username = ?',
      [username],
    );
    return rows[0] ?? null;
  }

  // Satu transaksi untuk seluruh batch: kalau satu gagal, tidak ada voucher
  // setengah jadi yang tertinggal.
  async createBatch(rows: Array<Record<string, unknown>>): Promise<number> {
    if (rows.length === 0) return 0;
    await this.db.withTransaction(async (connection) => {
      const columns = Object.keys(rows[0]);
      const placeholders = `(${columns.map(() => '?').join(', ')})`;
      for (const row of rows) {
        await connection.query(
          `INSERT INTO radius_vouchers (${columns.join(', ')}) VALUES ${placeholders}`,
          columns.map((column) => row[column]),
        );
      }
    });
    return rows.length;
  }

  async update(id: number, data: Record<string, unknown>): Promise<void> {
    const columns = Object.keys(data);
    if (columns.length === 0) return;
    await this.db.execute(
      `UPDATE radius_vouchers SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(data), id],
    );
  }

  async removeByIds(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.db.execute(
      `DELETE FROM radius_vouchers WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    return result.affectedRows ?? 0;
  }

  async counts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ status: string; total: number }>(
      'SELECT status, COUNT(*) AS total FROM radius_vouchers GROUP BY status',
    );
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.total);
      return acc;
    }, {});
  }

  // Voucher yang masa aktifnya sudah lewat. Dipakai untuk menandai EXPIRED.
  async overdue(): Promise<VoucherRow[]> {
    return this.db.query<VoucherRow>(
      `SELECT * FROM radius_vouchers
        WHERE status IN ('ready-to-use','active')
          AND expires_at IS NOT NULL AND expires_at <= NOW()`,
    );
  }
}

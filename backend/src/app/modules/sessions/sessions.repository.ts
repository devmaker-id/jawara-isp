import { Injectable } from '@nestjs/common';
import { isIPv4 } from 'node:net';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';

/**
 * Sesi online dari accounting RADIUS (`radacct`), bukan dari perangkat.
 *
 * `acctstoptime IS NULL` = sesi yang belum ditutup NAS. Sesi bisa "basi" bila
 * NAS berhenti mengirim accounting (router mati/putus): barisnya tetap terbuka
 * walau pengguna sudah tidak tersambung. Karena itu ada penanda `stale`
 * berdasarkan `acctupdatetime`, bukan penghapusan baris.
 *
 * Jenis sesi ditentukan dari profil voucher/customer (`radius_vouchers.profile_type`)
 * karena `radacct` tidak membedakan hotspot dan PPPoE; bila username tidak
 * dikenal, dipakai `nasporttype` (Wireless-802.11 → hotspot).
 */
export type SessionKind = 'hotspot' | 'ppp';

const JENIS_SQL =
  "COALESCE(v.profile_type, CASE WHEN a.nasporttype LIKE 'Wireless%' THEN 'hotspot' ELSE 'ppp' END)";

const STALE_SQL =
  "(a.acctupdatetime IS NOT NULL AND a.acctupdatetime < (NOW() - INTERVAL 10 MINUTE))";

// SUMBER KEBENARAN TUNGGAL untuk definisi "basi": dipakai ulang oleh dashboard
// (angka online) dan sesi online. Jangan salin-tempel definisi ini ke modul
// lain — impor dari sini supaya ambang tidak bisa menyimpang.
export { STALE_SQL };

export interface OnlineSession {
  acctuniqueid: string;
  username: string | null;
  jenis: SessionKind;
  nasipaddress: string;
  nas_name: string | null;
  nasporttype: string | null;
  nasportid: string | null;
  callingstationid: string;
  framedipaddress: string;
  acctstarttime: string | null;
  acctupdatetime: string | null;
  acctsessiontime: number;
  acctinputoctets: number;
  acctoutputoctets: number;
  profile_name: string | null;
  user_type: string | null;
  owner_id: number | null;
  owner_name: string | null;
  stale: boolean;
}

export interface SessionFilter {
  jenis?: SessionKind;
  /**
   * Jenis akun yang sedang online: 'voucher' (akun cetak) atau 'customer'
   * (pelanggan berlangganan). Dipakai dashboard untuk memisahkan daftar sesi
   * hotspot — voucher dan customer tidak dikelola dengan cara yang sama.
   */
  userType?: 'voucher' | 'customer';
  search?: string;
  page?: number;
  limit?: number;
}

export interface SessionDetail extends OnlineSession {
  acctsessionid: string;
  realm: string | null;
  nasporttype: string | null;
  connectinfo_start: string | null;
  acctterminatecause: string;
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Cakupan baris di SQL: admin/operator melihat semua sesi, reseller hanya
   * sesi milik voucher/customer dengan owner_id miliknya. Identitas tanpa id
   * sah → `1 = 0` (gagal-tertutup).
   */
  private scopeFilter(scope: RequestScope): { sql: string; params: number[] } {
    if (!scope.isReseller) return { sql: '', params: [] };
    const id = scope.ownerId;
    if (id === null || !Number.isInteger(id) || id <= 0) {
      return { sql: '1 = 0', params: [] };
    }
    return { sql: 'v.owner_id = ?', params: [id] };
  }

  private baseWhere(filter: SessionFilter, scope: RequestScope): {
    clause: string;
    params: unknown[];
  } {
    const where: string[] = ['a.acctstoptime IS NULL'];
    const params: unknown[] = [];

    // Sesi "basi" bukan online: jangan tampil/dihitung sebagai sesi hidup.
    // `NOT ${STALE_SQL}` menyimpan sesi yang acctupdatetime-nya NULL (baru,
    // belum ada interim) atau masih segar (< 10 menit). Definisi memakai
    // STALE_SQL — sumber tunggal yang sama dengan dashboard.
    where.push(`NOT ${STALE_SQL}`);

    if (filter.jenis) {
      where.push(`${JENIS_SQL} = ?`);
      params.push(filter.jenis);
    }
    if (filter.userType) {
      // Akun tanpa baris di radius_vouchers tidak punya user_type; bila filter
      // diminta, sesi seperti itu memang tidak masuk kelompok mana pun.
      where.push('v.user_type = ?');
      params.push(filter.userType);
    }
    if (filter.search) {
      where.push(
        '(a.username LIKE ? OR a.framedipaddress LIKE ? OR a.callingstationid LIKE ? OR a.nasipaddress LIKE ?)',
      );
      const like = `%${filter.search}%`;
      params.push(like, like, like, like);
    }
    const scopeFilter = this.scopeFilter(scope);
    if (scopeFilter.sql) {
      where.push(scopeFilter.sql);
      params.push(...scopeFilter.params);
    }
    return { clause: where.join(' AND '), params };
  }

  async list(
    filter: SessionFilter,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ rows: OnlineSession[]; total: number }> {
    const { clause, params } = this.baseWhere(filter, scope);
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 1000);

    const total = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total
         FROM radacct a
         LEFT JOIN radius_vouchers v ON v.username = a.username
        WHERE ${clause}`,
      params,
    );

    const rows = await this.db.query<RowDataPacket>(
      `SELECT a.acctuniqueid, a.username, ${JENIS_SQL} AS jenis,
              a.nasipaddress, n.shortname AS nas_name,
              a.nasporttype, a.nasportid, a.callingstationid, a.framedipaddress,
              a.acctstarttime, a.acctupdatetime, a.acctsessiontime,
              a.acctinputoctets, a.acctoutputoctets,
              ${STALE_SQL} AS stale,
              v.profile_name, v.user_type, v.owner_id, u.name AS owner_name
         FROM radacct a
         LEFT JOIN radius_vouchers v ON v.username = a.username
         LEFT JOIN users u ON u.id = v.owner_id
         LEFT JOIN nas n ON n.nasname = a.nasipaddress
        WHERE ${clause}
        ORDER BY a.acctstarttime DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );

    return { rows: rows.map((row) => this.toSession(row)), total: Number(total?.total ?? 0) };
  }

  async detail(
    acctuniqueid: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<SessionDetail | null> {
    const scopeFilter = this.scopeFilter(scope);
    const clause = ['a.acctuniqueid = ?', 'a.acctstoptime IS NULL', scopeFilter.sql]
      .filter(Boolean)
      .join(' AND ');

    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT a.acctuniqueid, a.acctsessionid, a.username, ${JENIS_SQL} AS jenis,
              a.realm, a.nasipaddress, n.shortname AS nas_name,
              a.nasporttype, a.nasportid, a.callingstationid, a.framedipaddress,
              a.acctstarttime, a.acctupdatetime, a.acctsessiontime,
              a.acctinputoctets, a.acctoutputoctets, a.acctterminatecause,
              a.connectinfo_start,
              ${STALE_SQL} AS stale,
              v.profile_name, v.user_type, v.owner_id, u.name AS owner_name
         FROM radacct a
         LEFT JOIN radius_vouchers v ON v.username = a.username
         LEFT JOIN users u ON u.id = v.owner_id
         LEFT JOIN nas n ON n.nasname = a.nasipaddress
        WHERE ${clause}
        LIMIT 1`,
      [acctuniqueid, ...scopeFilter.params],
    );

    if (!row) return null;
    return {
      ...this.toSession(row),
      acctsessionid: String(row.acctsessionid ?? ''),
      realm: row.realm ? String(row.realm) : null,
      connectinfo_start: row.connectinfo_start ? String(row.connectinfo_start) : null,
      acctterminatecause: String(row.acctterminatecause ?? ''),
    };
  }

  /** Data minimum untuk mengirim Disconnect-Request ke NAS. */
  async disconnectTarget(
    acctuniqueid: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{
    username: string | null;
    acctsessionid: string;
    nasipaddress: string;
    nas_name: string | null;
    jenis: SessionKind;
    framedipaddress: string;
  } | null> {
    const scopeFilter = this.scopeFilter(scope);
    const clause = ['a.acctuniqueid = ?', 'a.acctstoptime IS NULL', scopeFilter.sql]
      .filter(Boolean)
      .join(' AND ');

    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT a.username, a.acctsessionid, a.nasipaddress, a.framedipaddress,
              n.shortname AS nas_name, ${JENIS_SQL} AS jenis
         FROM radacct a
         LEFT JOIN radius_vouchers v ON v.username = a.username
         LEFT JOIN nas n ON n.nasname = a.nasipaddress
        WHERE ${clause}
        LIMIT 1`,
      [acctuniqueid, ...scopeFilter.params],
    );
    if (!row) return null;
    return {
      username: row.username ? String(row.username) : null,
      acctsessionid: String(row.acctsessionid ?? ''),
      nasipaddress: String(row.nasipaddress),
      nas_name: row.nas_name ? String(row.nas_name) : null,
      jenis: (row.jenis ?? 'hotspot') as SessionKind,
      framedipaddress: String(row.framedipaddress ?? ''),
    };
  }

  /**
   * Secret NAS untuk paket Disconnect. Diambil dari tabel `nas` — sumber yang
   * sama dengan yang dipakai FreeRADIUS (`read_clients = yes`, `client_table =
   * "nas"`). Nilainya tidak pernah dikembalikan ke pemanggil API.
   */
  async nasSecret(nasipaddress: string): Promise<string | null> {
    const row = await this.db.queryOne<{ secret: string }>(
      'SELECT secret FROM nas WHERE nasname = ? LIMIT 1',
      [nasipaddress],
    );
    const secret = row?.secret ? String(row.secret) : '';
    return secret.length > 0 ? secret : null;
  }

  /**
   * Sesi aktif milik satu username (dipakai untuk putus massal saat menghapus
   * akun, dan tombol tendang di halaman Sesi & Akuntansi). Mencakup semua NAS;
   * baris ditutup nanti oleh Accounting-Stop, atau oleh closeGhost bila NAS
   * menjawab NAK (sesi hantu).
   */
  async activeByUsername(username: string): Promise<
    Array<{
      acctuniqueid: string;
      acctsessionid: string;
      nasipaddress: string;
      framedipaddress: string;
    }>
  > {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT acctuniqueid, acctsessionid, nasipaddress, framedipaddress
         FROM radacct WHERE username = ? AND acctstoptime IS NULL`,
      [username],
    );
    return rows.map((row) => ({
      acctuniqueid: String(row.acctuniqueid),
      acctsessionid: String(row.acctsessionid ?? ''),
      nasipaddress: String(row.nasipaddress),
      framedipaddress: String(row.framedipaddress ?? ''),
    }));
  }

  /** Tutup baris radacct "hantu" yang NAS-nya sudah tidak punya sesi itu. */
  async closeGhost(acctuniqueid: string): Promise<void> {
    await this.db.execute(
      `UPDATE radacct SET acctstoptime = NOW(), acctterminatecause = 'CoA-Disconnect-NAK'
        WHERE acctuniqueid = ? AND acctstoptime IS NULL`,
      [acctuniqueid],
    );
  }

  /** Port CoA/Disconnect: `radius.coa_port` di tabel config, bawaan 3799. */
  async coaPort(): Promise<number> {
    const row = await this.db.queryOne<{ config_value: string }>(
      "SELECT config_value FROM config WHERE config_key = 'radius.coa_port' LIMIT 1",
    );
    const port = Number(row?.config_value);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 3799;
  }

  /**
   * Alamat lokal sumber paket CoA.
   *
   * RouterOS hanya memproses Disconnect-Request yang datang dari IP server
   * RADIUS yang terdaftar di `/radius` perangkat. Tanpa alamat ini paket keluar
   * dari IP rute (mis. 10.200.10.10) dan dibuang tanpa balasan.
   *
   * Urutan: config `radius.coa_source` → env `RADIUS_COA_SOURCE` → null (kernel).
   * ponytail: satu alamat untuk semua NAS; ubah ke peta per-NAS kalau kelak ada
   * NAS yang `/radius`-nya menunjuk alamat panel yang berbeda.
   */
  async coaSource(): Promise<string | null> {
    const row = await this.db
      .queryOne<{ config_value: string }>(
        "SELECT config_value FROM config WHERE config_key = 'radius.coa_source' LIMIT 1",
      )
      .catch(() => null);
    const value = String(row?.config_value ?? process.env.RADIUS_COA_SOURCE ?? '').trim();
    return isIPv4(value) ? value : null;
  }

  private toSession(row: RowDataPacket): OnlineSession {
    return {
      acctuniqueid: String(row.acctuniqueid),
      username: row.username ? String(row.username) : null,
      jenis: (row.jenis ?? 'hotspot') as SessionKind,
      nasipaddress: String(row.nasipaddress),
      nas_name: row.nas_name ? String(row.nas_name) : null,
      nasporttype: row.nasporttype ? String(row.nasporttype) : null,
      nasportid: row.nasportid ? String(row.nasportid) : null,
      callingstationid: String(row.callingstationid ?? ''),
      framedipaddress: String(row.framedipaddress ?? ''),
      acctstarttime: row.acctstarttime ? new Date(row.acctstarttime).toISOString() : null,
      acctupdatetime: row.acctupdatetime ? new Date(row.acctupdatetime).toISOString() : null,
      acctsessiontime: Number(row.acctsessiontime ?? 0),
      acctinputoctets: Number(row.acctinputoctets ?? 0),
      acctoutputoctets: Number(row.acctoutputoctets ?? 0),
      profile_name: row.profile_name ? String(row.profile_name) : null,
      user_type: row.user_type ? String(row.user_type) : null,
      owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
      owner_name: row.owner_name ? String(row.owner_name) : null,
      stale: Number(row.stale) === 1,
    };
  }
}

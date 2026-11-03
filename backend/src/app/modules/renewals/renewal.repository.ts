import { Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { freeRadiusDate } from '../freeradius/radius-enforcement.service';
import { RequestScope } from '../auth/request-scope';

/**
 * Data yang dibaca/ditulis proses perpanjangan.
 *
 * Tidak ada tabel baru untuk akun atau tagihan: akun tetap `radius_vouchers`,
 * uang tetap `invoices` + `payments`. Hanya tindakan perpanjangannya yang
 * dicatat di `service_renewals` (bukti siapa/kapan/periode apa).
 */

export type RenewalErrorCode =
  | 'CUSTOMER_NOT_FOUND'
  | 'ACCOUNT_MISSING'
  | 'PROFILE_INVALID'
  | 'NO_VALIDITY'
  | 'CUSTOMER_BLOCKED'
  | 'PERIOD_TAKEN'
  | 'EXPIRY_CHANGED';

export class RenewalError extends Error {
  constructor(
    public readonly code: RenewalErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface RenewalCustomer {
  id: number;
  name: string;
  status: string;
  internet_no: string | null;
  owner_id: number | null;
}

export interface RenewalAccount {
  id: number;
  username: string;
  password: string;
  profile_type: 'hotspot' | 'ppp';
  profile_id: number;
  profile_name: string;
  status: string;
  expires_at: Date | null;
  first_login_at: Date | null;
}

export interface RenewalProfile {
  id: number;
  name: string;
  radius_group: string | null;
  sell_price: number;
  promo_price: number;
  tax_percent: number;
  validity_value: number;
  validity_unit: 'minute' | 'hour' | 'day' | 'month';
  is_active: number;
}

export interface ApplyRenewalInput {
  customerId: number;
  accountId: number;
  username: string;
  password: string;
  profileType: 'hotspot' | 'ppp';
  profileId: number;
  profileName: string;
  groupname: string;
  /** Masa aktif yang diharapkan (dibaca sebelum transaksi) — penjaga balapan. */
  expectedExpiresAt: Date | null;
  newExpiresAt: Date;
  periodStart: Date;
  durationSeconds: number;
  amount: number;
  invoiceId: number;
  paymentId: number | null;
  actorId: number;
  actorName: string;
  note: string | null;
  idempotencyKey: string;
}

export interface RenewalRecord {
  id: number;
  customer_id: number;
  account_id: number;
  username: string;
  profile_type: string;
  profile_id: number;
  profile_name: string;
  prev_expires_at: Date | null;
  period_start: Date;
  period_end: Date | null;
  duration_seconds: number;
  amount: number;
  invoice_id: number | null;
  payment_id: number | null;
  actor_name: string | null;
  note: string | null;
  idempotency_key: string | null;
  created_at: Date;
}

const sameInstant = (a: Date | null, b: Date | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
};

@Injectable()
export class RenewalRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Pelanggan dalam cakupan pemanggil. Reseller tanpa identitas sah selalu
   * gagal (fail-closed) — bukan berarti "semua pelanggan".
   */
  async customer(customerId: number, scope: RequestScope): Promise<RenewalCustomer | null> {
    const params: unknown[] = [customerId];
    let ownerSql = '';
    if (scope.isReseller) {
      if (!scope.ownerId || !Number.isInteger(scope.ownerId) || scope.ownerId <= 0) return null;
      ownerSql = ' AND c.owner_id = ?';
      params.push(scope.ownerId);
    }
    const rows = await this.db.query<RowDataPacket>(
      `SELECT c.id, c.name, c.status, c.internet_no, c.owner_id
         FROM customers c
        WHERE c.id = ?${ownerSql}`,
      params,
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: Number(row.id),
      name: String(row.name),
      status: String(row.status ?? 'active'),
      internet_no: row.internet_no === null ? null : String(row.internet_no),
      owner_id: row.owner_id === null ? null : Number(row.owner_id),
    };
  }

  /** Akun layanan milik pelanggan; `username` opsional untuk memilih satu. */
  async account(customerId: number, username?: string): Promise<RenewalAccount | null> {
    const params: unknown[] = [customerId];
    let usernameSql = '';
    if (username) {
      usernameSql = ' AND v.username = ?';
      params.push(username);
    }
    const rows = await this.db.query<RowDataPacket>(
      `SELECT v.id, v.username, v.password, v.profile_type, v.profile_id, v.profile_name,
              v.status, v.expires_at, v.first_login_at
         FROM radius_vouchers v
        WHERE v.customer_id = ?${usernameSql}
        ORDER BY v.id
        LIMIT 1`,
      params,
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: Number(row.id),
      username: String(row.username),
      password: String(row.password ?? ''),
      profile_type: String(row.profile_type) === 'ppp' ? 'ppp' : 'hotspot',
      profile_id: Number(row.profile_id),
      profile_name: String(row.profile_name ?? ''),
      status: String(row.status ?? 'new-created'),
      expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
      first_login_at: row.first_login_at ? new Date(row.first_login_at as string) : null,
    };
  }

  /** Profil layanan; tabel dipilih dari tipe akun (bukan dari input pengguna). */
  async profile(
    type: 'hotspot' | 'ppp',
    profileId: number,
  ): Promise<RenewalProfile | null> {
    const table = type === 'ppp' ? 'ppp_profiles' : 'hotspot_profiles';
    const rows = await this.db.query<RowDataPacket>(
      `SELECT id, name, radius_group, sell_price, promo_price, tax_percent,
              validity_value, validity_unit, is_active
         FROM ${table}
        WHERE id = ?`,
      [profileId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: Number(row.id),
      name: String(row.name),
      radius_group: row.radius_group === null ? null : String(row.radius_group),
      sell_price: Number(row.sell_price ?? 0),
      promo_price: Number(row.promo_price ?? 0),
      tax_percent: Number(row.tax_percent ?? 0),
      validity_value: Number(row.validity_value ?? 0),
      validity_unit: String(row.validity_unit ?? 'day') as RenewalProfile['validity_unit'],
      is_active: Number(row.is_active ?? 0),
    };
  }

  /** Tagihan yang sudah ada untuk periode ini (pencegah tagihan ganda). */
  async invoiceForPeriod(
    customerId: number,
    username: string,
    periodStart: string,
  ): Promise<{ id: number; invoice_number: string } | null> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT id, invoice_number
         FROM invoices
        WHERE customer_id = ? AND username <=> ? AND period_key = ? AND status <> 'void'
        LIMIT 1`,
      [customerId, username, periodStart],
    );
    if (rows.length === 0) return null;
    return { id: Number(rows[0].id), invoice_number: String(rows[0].invoice_number) };
  }

  /**
   * Tulis perpanjangan dalam satu transaksi: masa aktif, grup RADIUS,
   * `Expiration` FreeRADIUS, dan catatan `service_renewals`.
   *
   * `SELECT ... FOR UPDATE` + pembandingan masa aktif lama mencegah dua
   * permintaan bersamaan memperpanjang dua kali.
   */
  async apply(input: ApplyRenewalInput, conn?: PoolConnection): Promise<RenewalRecord> {
    if (conn) return this.applyWith(conn, input);
    return this.db.withTransaction((connection) => this.applyWith(connection, input));
  }

  private async applyWith(
    connection: PoolConnection,
    input: ApplyRenewalInput,
  ): Promise<RenewalRecord> {
    {
      const [locked] = await connection.query<RowDataPacket[]>(
        'SELECT id, expires_at FROM radius_vouchers WHERE id = ? FOR UPDATE',
        [input.accountId],
      );
      if (locked.length === 0) {
        throw new RenewalError('ACCOUNT_MISSING', 'Akun layanan tidak ditemukan.');
      }
      const currentExpiry = locked[0].expires_at
        ? new Date(locked[0].expires_at as string)
        : null;
      if (!sameInstant(currentExpiry, input.expectedExpiresAt)) {
        throw new RenewalError(
          'EXPIRY_CHANGED',
          'Masa aktif berubah saat proses berjalan (mungkin sudah diperpanjang). Muat ulang lalu ulangi.',
        );
      }

      await connection.query(
        `UPDATE radius_vouchers
            SET status = 'active',
                expires_at = ?,
                first_login_at = COALESCE(first_login_at, NOW()),
                online_seconds = 0,
                quota_used_bytes = 0,
                usage_reset_at = NOW(),
                block_reason = NULL,
                isolir_at = NULL
          WHERE id = ?`,
        [input.newExpiresAt, input.accountId],
      );

      // Grup dikembalikan ke profil aslinya (keluar dari ISOLIR).
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [input.username]);
      await connection.query(
        'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
        [input.username, input.groupname],
      );

      // Sisa blokir hotspot: Auth-Type := Reject di radcheck dan Reply-Message
      // di radreply. Keduanya harus hilang, kalau tidak akun tetap ditolak
      // walau masa aktif sudah diperpanjang.
      await connection.query(
        'DELETE FROM radcheck WHERE username = ? AND attribute IN (?, ?)',
        [input.username, 'Expiration', 'Auth-Type'],
      );
      await connection.query(
        'DELETE FROM radreply WHERE username = ? AND attribute = ?',
        [input.username, 'Reply-Message'],
      );

      // Akun yang sempat dicabut (expired) perlu kata sandi lagi.
      const [passwordRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1",
        [input.username],
      );
      if (passwordRows.length === 0) {
        await connection.query(
          "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)",
          [input.username, input.password],
        );
      }

      // FreeRADIUS menolak sendiri setelah Expiration; ini yang membuat
      // penegakan tidak bergantung pada proses Node tetap hidup.
      await connection.query(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        [input.username, 'Expiration', ':=', freeRadiusDate(input.newExpiresAt)],
      );

      const [result] = await connection.query(
        `INSERT INTO service_renewals
           (customer_id, account_id, username, profile_type, profile_id, profile_name,
            prev_expires_at, period_start, period_end, duration_seconds, amount,
            invoice_id, payment_id, actor_id, actor_name, note, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.customerId,
          input.accountId,
          input.username,
          input.profileType,
          input.profileId,
          input.profileName,
          input.expectedExpiresAt,
          input.periodStart,
          input.newExpiresAt,
          input.durationSeconds,
          input.amount,
          input.invoiceId,
          input.paymentId,
          input.actorId,
          input.actorName,
          input.note,
          input.idempotencyKey,
        ],
      );
      const insertId = Number((result as unknown as { insertId: number }).insertId);

      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM service_renewals WHERE id = ?',
        [insertId],
      );
      return toRecord(rows[0]);
    }
  }

  /** Perpanjangan yang sudah tercatat dengan kunci ini (idempotensi). */
  async byKey(key: string): Promise<RenewalRecord | null> {
    const rows = await this.db.query<RowDataPacket>(
      'SELECT * FROM service_renewals WHERE idempotency_key = ? LIMIT 1',
      [key],
    );
    return rows.length === 0 ? null : toRecord(rows[0]);
  }

  async history(customerId: number, limit = 50): Promise<RenewalRecord[]> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT * FROM service_renewals
        WHERE customer_id = ?
        ORDER BY id DESC
        LIMIT ?`,
      [customerId, Math.min(Math.max(limit, 1), 200)],
    );
    return rows.map(toRecord);
  }
}

function toRecord(row: RowDataPacket): RenewalRecord {
  return {
    id: Number(row.id),
    customer_id: Number(row.customer_id),
    account_id: Number(row.account_id),
    username: String(row.username),
    profile_type: String(row.profile_type),
    profile_id: Number(row.profile_id),
    profile_name: String(row.profile_name),
    prev_expires_at: row.prev_expires_at ? new Date(row.prev_expires_at as string) : null,
    period_start: new Date(row.period_start as string),
    period_end: row.period_end ? new Date(row.period_end as string) : null,
    duration_seconds: Number(row.duration_seconds),
    amount: Number(row.amount),
    invoice_id: row.invoice_id === null ? null : Number(row.invoice_id),
    payment_id: row.payment_id === null ? null : Number(row.payment_id),
    actor_name: row.actor_name === null ? null : String(row.actor_name),
    note: row.note === null ? null : String(row.note),
    idempotency_key: row.idempotency_key === null ? null : String(row.idempotency_key),
    created_at: new Date(row.created_at as string),
  };
}
import { Injectable } from '@nestjs/common';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { DatabaseService } from '../../database/database.service';

/**
 * Ringkasan kontribusi per akun: berapa pelanggan, voucher, profil, dan group
 * yang DIBUAT oleh masing-masing akun.
 *
 * Sengaja dihitung dari `created_by` (siapa yang menekan Simpan), bukan dari
 * `owner_id` (milik siapa datanya) — pertanyaan "dibuat oleh siapa" tidak bisa
 * dijawab oleh kolom pemilik, karena admin sering membuatkan data untuk
 * reseller.
 *
 * Tidak ada tabel baru: satu UNION ALL dari lima tabel, diagregasi di SQL.
 */
export interface ContributionRow {
  user_id: number;
  name: string;
  role: string;
  customers: number;
  vouchers: number;
  hotspot_profiles: number;
  ppp_profiles: number;
  group_profiles: number;
  total: number;
}

@Injectable()
export class ContributionsService {
  constructor(private readonly db: DatabaseService) {}

  async summary(
    from: string | undefined,
    to: string | undefined,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ from: string | null; to: string | null; rows: ContributionRow[]; total: number }> {
    // Batas tanggal inklusif: `to` mencakup seluruh hari tersebut.
    const start = from ? `${from} 00:00:00` : null;
    const end = to ? `${to} 23:59:59` : null;

    // Reseller hanya melihat barisnya sendiri; angkanya pun tidak membocorkan
    // jumlah data akun lain.
    const onlyUser = scope.isReseller ? scope.ownerId : null;

    const parts: string[] = [];
    const params: unknown[] = [];

    const push = (table: string, column: string, bucket: string) => {
      const where: string[] = [`${column} IS NOT NULL`];
      if (start) {
        where.push('created_at >= ?');
        params.push(start);
      }
      if (end) {
        where.push('created_at <= ?');
        params.push(end);
      }
      if (onlyUser) {
        where.push(`${column} = ?`);
        params.push(onlyUser);
      }
      parts.push(
        `SELECT ${column} AS user_id,
                ${bucket === 'customers' ? 'COUNT(*)' : '0'} AS customers,
                ${bucket === 'vouchers' ? 'COUNT(*)' : '0'} AS vouchers,
                ${bucket === 'hotspot_profiles' ? 'COUNT(*)' : '0'} AS hotspot_profiles,
                ${bucket === 'ppp_profiles' ? 'COUNT(*)' : '0'} AS ppp_profiles,
                ${bucket === 'group_profiles' ? 'COUNT(*)' : '0'} AS group_profiles
           FROM ${table} WHERE ${where.join(' AND ')}`,
      );
    };

    push('customers', 'created_by', 'customers');
    push('radius_vouchers', 'created_by', 'vouchers');
    push('hotspot_profiles', 'created_by', 'hotspot_profiles');
    push('ppp_profiles', 'created_by', 'ppp_profiles');
    push('group_profiles', 'created_by', 'group_profiles');

    const rows = await this.db.query<{
      user_id: number;
      name: string;
      role: string;
      customers: number;
      vouchers: number;
      hotspot_profiles: number;
      ppp_profiles: number;
      group_profiles: number;
      total: number;
    }>(
      `SELECT u.id AS user_id, u.name, u.role,
              SUM(x.customers) AS customers,
              SUM(x.vouchers) AS vouchers,
              SUM(x.hotspot_profiles) AS hotspot_profiles,
              SUM(x.ppp_profiles) AS ppp_profiles,
              SUM(x.group_profiles) AS group_profiles,
              SUM(x.customers + x.vouchers + x.hotspot_profiles + x.ppp_profiles + x.group_profiles) AS total
         FROM (${parts.join(' UNION ALL ')}) x
         JOIN users u ON u.id = x.user_id
        GROUP BY u.id, u.name, u.role
        ORDER BY total DESC, u.name`,
      params,
    );

    return {
      from: from ?? null,
      to: to ?? null,
      rows: rows.map((row) => ({
        user_id: Number(row.user_id),
        name: String(row.name),
        role: String(row.role),
        customers: Number(row.customers ?? 0),
        vouchers: Number(row.vouchers ?? 0),
        hotspot_profiles: Number(row.hotspot_profiles ?? 0),
        ppp_profiles: Number(row.ppp_profiles ?? 0),
        group_profiles: Number(row.group_profiles ?? 0),
        total: Number(row.total ?? 0),
      })),
      total: rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    };
  }
}

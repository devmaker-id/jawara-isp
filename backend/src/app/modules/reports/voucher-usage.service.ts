import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';

/**
 * Laporan penggunaan pertama voucher — INDIKATOR OPERASIONAL, bukan penjualan.
 *
 * Sumber waktu pakai adalah `radpostauth` (`MIN(authdate)` per username untuk
 * reply `Access-Accept`), BUKAN `radius_vouchers.first_login_at`: kolom itu
 * diisi job penegakan, sehingga bisa terlambat atau tetap NULL walau voucher
 * sudah dipakai (terbukti di data: ada voucher Accept dengan first_login_at
 * NULL).
 *
 * Satu voucher dihitung sekali karena `MIN(authdate)` diambil per username dan
 * `radius_vouchers.username` UNIQUE.
 *
 * Harga modal diambil dari profil SAAT INI, jadi nilainya estimasi, bukan
 * historis — mengubah harga profil ikut mengubah laporan bulan lalu.
 */
export interface VoucherUsageRow {
  tanggal: string;
  owner_id: number | null;
  agen: string;
  /** `pemilik-tercatat` = owner_id terisi; `tanpa-pemilik` = atribusi kosong. */
  atribusi: 'pemilik-tercatat' | 'tanpa-pemilik';
  profile_name: string;
  profile_type: 'hotspot' | 'ppp';
  harga_jual: number;
  /** null = profil tidak ditemukan / harga modal belum diisi. */
  harga_modal: number | null;
  voucher_unik: number;
  total_jual: number;
  estimasi_modal: number;
}

export interface VoucherUsageReport {
  from: string | null;
  to: string | null;
  rows: VoucherUsageRow[];
  by_owner: Array<{
    owner_id: number | null;
    agen: string;
    voucher_unik: number;
    total_jual: number;
    estimasi_modal: number;
  }>;
  total_vouchers: number;
  total_jual: number;
  estimasi_modal: number;
}

@Injectable()
export class VoucherUsageService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Cakupan baris, dipaksa di SQL (bukan filter di memori):
   *   admin    → semua
   *   reseller → hanya stok miliknya
   *   operator → stok miliknya atau yang ia buat
   * Identitas tanpa id sah → `1 = 0` (gagal-tertutup).
   */
  private scopeFilter(scope: RequestScope): { sql: string; params: number[] } {
    if (scope.role === 'admin') return { sql: '', params: [] };
    const userId = scope.userId;
    if (userId === null || !Number.isInteger(userId) || userId <= 0) {
      return { sql: '1 = 0', params: [] };
    }
    if (scope.isReseller) return { sql: 'v.owner_id = ?', params: [userId] };
    return { sql: '(v.owner_id = ? OR v.created_by = ?)', params: [userId, userId] };
  }

  async summary(
    from: string | undefined,
    to: string | undefined,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<VoucherUsageReport> {
    const where: string[] = [];
    const params: unknown[] = [];
    const scopeFilter = this.scopeFilter(scope);

    // Tanggal dikelompokkan menurut Asia/Jakarta (+07:00), eksplisit lewat
    // CONVERT_TZ supaya tidak bergantung pada zona sesi koneksi.
    if (from) {
      where.push("DATE(CONVERT_TZ(f.first_at, @@session.time_zone, '+07:00')) >= ?");
      params.push(from);
    }
    if (to) {
      where.push("DATE(CONVERT_TZ(f.first_at, @@session.time_zone, '+07:00')) <= ?");
      params.push(to);
    }
    if (scopeFilter.sql) {
      where.push(scopeFilter.sql);
      params.push(...scopeFilter.params);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await this.db.query<RowDataPacket>(
      `WITH first_use AS (
         SELECT p.username, MIN(p.authdate) AS first_at
           FROM radpostauth p
          WHERE p.reply = 'Access-Accept'
            AND p.username NOT REGEXP '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$'
          GROUP BY p.username
       )
       SELECT DATE_FORMAT(DATE(CONVERT_TZ(f.first_at, @@session.time_zone, '+07:00')), '%Y-%m-%d') AS tanggal,
              v.owner_id,
              COALESCE(u.name, 'Tanpa pemilik') AS agen,
              v.profile_name,
              v.profile_type,
              v.price AS harga_jual,
              COALESCE(h.cost_price, pp.cost_price) AS harga_modal,
              COUNT(*) AS voucher_unik,
              SUM(v.price) AS total_jual,
              SUM(COALESCE(h.cost_price, pp.cost_price, 0)) AS estimasi_modal
         FROM first_use f
         JOIN radius_vouchers v ON v.username = f.username AND v.user_type = 'voucher'
         LEFT JOIN users u ON u.id = v.owner_id
         LEFT JOIN hotspot_profiles h ON v.profile_type = 'hotspot' AND h.id = v.profile_id
         LEFT JOIN ppp_profiles pp ON v.profile_type = 'ppp' AND pp.id = v.profile_id
         ${clause}
        GROUP BY tanggal, v.owner_id, agen, v.profile_name, v.profile_type, v.price, harga_modal
        ORDER BY tanggal DESC, agen
        LIMIT 1000`,
      params,
    );

    const mapped: VoucherUsageRow[] = rows.map((row) => ({
      tanggal: String(row.tanggal),
      owner_id: row.owner_id === null ? null : Number(row.owner_id),
      agen: String(row.agen ?? 'Tanpa pemilik'),
      atribusi: row.owner_id === null ? 'tanpa-pemilik' : 'pemilik-tercatat',
      profile_name: String(row.profile_name ?? ''),
      profile_type: (row.profile_type ?? 'hotspot') as 'hotspot' | 'ppp',
      harga_jual: Number(row.harga_jual ?? 0),
      harga_modal: row.harga_modal === null ? null : Number(row.harga_modal),
      voucher_unik: Number(row.voucher_unik ?? 0),
      total_jual: Number(row.total_jual ?? 0),
      estimasi_modal: Number(row.estimasi_modal ?? 0),
    }));

    // Total per agen dijumlahkan dari baris yang sudah dibatasi cakupan.
    const perOwner = new Map<string, VoucherUsageReport['by_owner'][number]>();
    for (const row of mapped) {
      const key = `${row.owner_id ?? 'null'}|${row.agen}`;
      const bucket = perOwner.get(key) ?? {
        owner_id: row.owner_id,
        agen: row.agen,
        voucher_unik: 0,
        total_jual: 0,
        estimasi_modal: 0,
      };
      bucket.voucher_unik += row.voucher_unik;
      bucket.total_jual += row.total_jual;
      bucket.estimasi_modal += row.estimasi_modal;
      perOwner.set(key, bucket);
    }

    return {
      from: from ?? null,
      to: to ?? null,
      rows: mapped,
      by_owner: [...perOwner.values()].sort((a, b) => b.voucher_unik - a.voucher_unik),
      total_vouchers: mapped.reduce((sum, row) => sum + row.voucher_unik, 0),
      total_jual: mapped.reduce((sum, row) => sum + row.total_jual, 0),
      estimasi_modal: mapped.reduce((sum, row) => sum + row.estimasi_modal, 0),
    };
  }
}

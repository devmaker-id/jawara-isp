import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';

/**
 * Akses data penjualan voucher + rekap pendapatan.
 *
 * Rekap pendapatan menggabungkan DUA sumber uang:
 *   1. `payments`       → pembayaran tagihan customer/pelanggan
 *   2. `voucher_sales`  → penjualan voucher (modal + harga jual)
 *
 * Keduanya disatukan di satu query (UNION ALL) supaya angka dashboard dan
 * laporan tidak mungkin berbeda karena dua perhitungan terpisah.
 */

export interface VoucherSale {
  id: number;
  voucher_id: number | null;
  username: string | null;
  profile_name: string;
  profile_type: 'hotspot' | 'ppp';
  quantity: number;
  cost_price: number;
  sell_price: number;
  total_cost: number;
  total_sell: number;
  margin: number;
  owner_id: number | null;
  owner_name: string | null;
  recorded_by: number | null;
  recorded_by_name: string | null;
  buyer_name: string | null;
  method: string;
  note: string | null;
  sold_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface RevenueSummary {
  from: string | null;
  to: string | null;
  /** Uang dari tagihan customer/pelanggan. */
  payments_income: number;
  /** Uang dari penjualan voucher. */
  voucher_income: number;
  /** Modal voucher yang terjual pada periode. */
  voucher_cost: number;
  /** Laba kotor voucher (jual - modal). */
  voucher_margin: number;
  /** payments_income + voucher_income. */
  total_income: number;
  transactions: number;
  /** Rincian per pemilik data (untuk admin). */
  by_owner: Array<{ owner_id: number | null; owner_name: string; income: number; margin: number }>;
}

export interface SaleFilter {
  from?: string;
  to?: string;
  profile_type?: 'hotspot' | 'ppp';
  owner_id?: number;
  page?: number;
  limit?: number;
}

@Injectable()
export class VoucherSalesRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Filter cakupan pendapatan.
   *
   *   admin    → semua data, semua role
   *   operator → yang ia catat ATAU yang ia miliki
   *   reseller → hanya miliknya
   *
   * Dipakai untuk kolom `owner_id`/`recorded_by` pada gabungan di bawah, jadi
   * satu aturan berlaku untuk pembayaran maupun penjualan voucher.
   */
  static revenueFilter(scope: RequestScope | undefined): { sql: string; params: number[] } {
    const active = scope ?? SYSTEM_SCOPE;
    if (active.role === 'admin') return { sql: '', params: [] };
    const userId = active.userId;
    if (userId === null || !Number.isInteger(userId) || userId <= 0) {
      return { sql: '1 = 0', params: [] };
    }
    if (active.isReseller) return { sql: 't.owner_id = ?', params: [userId] };
    // Operator: staf yang mencatat transaksi, sekaligus bisa menjadi pemilik.
    return { sql: '(t.owner_id = ? OR t.recorded_by = ?)', params: [userId, userId] };
  }

  /** Rentang tanggal: [awal, akhir+1 hari) supaya `to` inklusif. */
  private range(from?: string, to?: string): { sql: string; params: string[] } {
    const parts: string[] = [];
    const params: string[] = [];
    if (from) {
      parts.push('t.at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      parts.push('t.at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(`${to} 00:00:00`);
    }
    return { sql: parts.length > 0 ? parts.join(' AND ') : '', params };
  }

  async revenue(from?: string, to?: string, scope?: RequestScope): Promise<RevenueSummary> {
    const range = this.range(from, to);
    const scopeFilter = VoucherSalesRepository.revenueFilter(scope);
    const where = [range.sql, scopeFilter.sql].filter(Boolean).join(' AND ');

    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT
         COALESCE(SUM(CASE WHEN t.source = 'payment' THEN t.amount ELSE 0 END), 0) AS payments_income,
         COALESCE(SUM(CASE WHEN t.source = 'voucher' THEN t.amount ELSE 0 END), 0) AS voucher_income,
         COALESCE(SUM(CASE WHEN t.source = 'voucher' THEN t.cost ELSE 0 END), 0)   AS voucher_cost,
         COALESCE(SUM(t.amount), 0) AS total_income,
         COUNT(*) AS transactions
       FROM (${this.unionSql()}) t
       ${where ? `WHERE ${where}` : ''}`,
      [...range.params, ...scopeFilter.params],
    );

    const paymentsIncome = Number(row?.payments_income ?? 0);
    const voucherIncome = Number(row?.voucher_income ?? 0);
    const voucherCost = Number(row?.voucher_cost ?? 0);

    // Rincian per pemilik hanya berguna bila cakupannya lintas pemilik.
    const byOwner = await this.db
      .query<RowDataPacket>(
        `SELECT t.owner_id,
                COALESCE(u.name, 'Tanpa pemilik') AS owner_name,
                COALESCE(SUM(t.amount), 0) AS income,
                COALESCE(SUM(CASE WHEN t.source = 'voucher' THEN t.amount - t.cost ELSE 0 END), 0) AS margin
           FROM (${this.unionSql()}) t
           LEFT JOIN users u ON u.id = t.owner_id
          ${where ? `WHERE ${where}` : ''}
          GROUP BY t.owner_id, owner_name
          ORDER BY income DESC
          LIMIT 50`,
        [...range.params, ...scopeFilter.params],
      )
      .catch(() => []);

    return {
      from: from ?? null,
      to: to ?? null,
      payments_income: paymentsIncome,
      voucher_income: voucherIncome,
      voucher_cost: voucherCost,
      voucher_margin: voucherIncome - voucherCost,
      total_income: Number(row?.total_income ?? 0),
      transactions: Number(row?.transactions ?? 0),
      by_owner: byOwner.map((item) => ({
        owner_id: item.owner_id === null ? null : Number(item.owner_id),
        owner_name: String(item.owner_name),
        income: Number(item.income),
        margin: Number(item.margin),
      })),
    };
  }

  /**
   * Pendapatan per hari (grafik harian dashboard), urut tanggal. Mengembalikan
   * hanya hari yang punya transaksi — pemanggil mengisi hari kosong dengan nol.
   */
  async revenueDaily(
    from: string,
    to: string,
    scope?: RequestScope,
  ): Promise<Array<{ day: string; payments: number; vouchers: number }>> {
    const range = this.range(from, to);
    const scopeFilter = VoucherSalesRepository.revenueFilter(scope);
    const where = [range.sql, scopeFilter.sql].filter(Boolean).join(' AND ');
    const rows = await this.db.query<RowDataPacket>(
      `SELECT DATE_FORMAT(t.at, '%Y-%m-%d') AS day,
              COALESCE(SUM(CASE WHEN t.source = 'payment' THEN t.amount ELSE 0 END), 0) AS payments,
              COALESCE(SUM(CASE WHEN t.source = 'voucher' THEN t.amount ELSE 0 END), 0) AS vouchers
         FROM (${this.unionSql()}) t
        ${where ? `WHERE ${where}` : ''}
        GROUP BY DATE_FORMAT(t.at, '%Y-%m-%d')
        ORDER BY day`,
      [...range.params, ...scopeFilter.params],
    );
    return rows.map((row) => ({
      day: String(row.day),
      payments: Number(row.payments ?? 0),
      vouchers: Number(row.vouchers ?? 0),
    }));
  }

  /**
   * Satu bentuk baris untuk kedua sumber uang: sumber, nominal, modal, pemilik,
   * pencatat, waktu. Semua perhitungan di atasnya memakai kolom yang sama,
   * sehingga menambah sumber pendapatan baru cukup menambah satu UNION.
   */
  private unionSql(): string {
    return `
      SELECT 'payment' AS source,
             p.amount AS amount,
             0 AS cost,
             c.owner_id AS owner_id,
             p.recorded_by AS recorded_by,
             p.paid_at AS at
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN customers c ON c.id = i.customer_id
       WHERE p.voided_at IS NULL
      UNION ALL
      SELECT 'voucher' AS source,
             vs.sell_price * vs.quantity AS amount,
             vs.cost_price * vs.quantity AS cost,
             vs.owner_id,
             vs.recorded_by,
             vs.sold_at
        FROM voucher_sales vs
       WHERE vs.voided_at IS NULL`;
  }

  async list(filter: SaleFilter, scope?: RequestScope): Promise<{ rows: VoucherSale[]; total: number }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    // Urutan params WAJIB sama dengan urutan where.
    if (filter.from) {
      where.push('vs.sold_at >= ?');
      params.push(`${filter.from} 00:00:00`);
    }
    if (filter.to) {
      where.push('vs.sold_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(`${filter.to} 00:00:00`);
    }
    if (filter.profile_type) {
      where.push('vs.profile_type = ?');
      params.push(filter.profile_type);
    }
    if (filter.owner_id !== undefined) {
      where.push('vs.owner_id = ?');
      params.push(filter.owner_id);
    }

    const scopeFilter = VoucherSalesRepository.revenueFilter(scope);
    if (scopeFilter.sql) {
      where.push(scopeFilter.sql.replace(/t\./g, 'vs.'));
      params.push(...scopeFilter.params);
    }

    const clause = where.join(' AND ');
    const total = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM voucher_sales vs WHERE ${clause}`,
      params,
    );
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 25), 1), 1000);

    const rows = await this.db.query<RowDataPacket>(
      `SELECT vs.*, u.name AS owner_name, r.name AS recorded_by_name
         FROM voucher_sales vs
         LEFT JOIN users u ON u.id = vs.owner_id
         LEFT JOIN users r ON r.id = vs.recorded_by
        WHERE ${clause}
        ORDER BY vs.sold_at DESC, vs.id DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );

    return { rows: rows.map((row) => this.toSale(row)), total: Number(total?.total ?? 0) };
  }

  async create(values: {
    voucher_id: number | null;
    username: string | null;
    profile_name: string;
    profile_type: 'hotspot' | 'ppp';
    quantity: number;
    cost_price: number;
    sell_price: number;
    owner_id: number;
    recorded_by: number;
    buyer_name: string | null;
    method: string;
    note: string | null;
    sold_at?: string | null;
  }): Promise<number> {
    const result = await this.db.execute(
      `INSERT INTO voucher_sales
         (voucher_id, username, profile_name, profile_type, quantity, cost_price,
          sell_price, owner_id, recorded_by, buyer_name, method, note, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.voucher_id,
        values.username,
        values.profile_name,
        values.profile_type,
        values.quantity,
        values.cost_price,
        values.sell_price,
        values.owner_id,
        values.recorded_by,
        values.buyer_name,
        values.method,
        values.note,
        values.sold_at ?? new Date(),
      ],
    );
    return Number(result.insertId);
  }

  async findById(id: number): Promise<RowDataPacket | null> {
    return this.db.queryOne<RowDataPacket>('SELECT * FROM voucher_sales WHERE id = ?', [id]);
  }

  /** Batalkan tanpa menghapus: jejak uang tetap ada, angkanya keluar dari total. */
  async void(id: number, actorId: number, reason: string): Promise<void> {
    await this.db.execute(
      `UPDATE voucher_sales
          SET voided_at = NOW(), voided_by = ?, void_reason = ?
        WHERE id = ? AND voided_at IS NULL`,
      [actorId, reason, id],
    );
  }

  /** Voucher yang belum pernah dicatat penjualannya (untuk pilihan di form). */
  async unsoldVouchers(ownerId?: number, limit = 100): Promise<RowDataPacket[]> {
    // Hanya voucher sungguhan. Akun pelanggan (user_type='customer') tinggal di
    // tabel yang sama tetapi bukan barang dagangan: menjualnya berarti menjual
    // akun pelanggan, bukan voucher.
    const where = [
      "v.user_type = 'voucher'",
      'v.id NOT IN (SELECT voucher_id FROM voucher_sales WHERE voucher_id IS NOT NULL AND voided_at IS NULL)',
    ];
    const params: unknown[] = [];
    if (ownerId !== undefined) {
      where.push('v.owner_id = ?');
      params.push(ownerId);
    }
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    return this.db.query<RowDataPacket>(
      // Kolom harga di radius_vouchers bernama `price` (bukan sell_price) —
      // memakai nama yang salah membuat endpoint ini gagal 500.
      `SELECT v.id, v.username, v.profile_name, v.profile_type, v.owner_id,
              COALESCE(v.price, 0) AS sell_price
         FROM radius_vouchers v
        WHERE ${where.join(' AND ')}
        ORDER BY v.id DESC
        LIMIT ${safeLimit}`,
      params,
    );
  }

  private toSale(row: RowDataPacket): VoucherSale {
    const quantity = Number(row.quantity ?? 1);
    const cost = Number(row.cost_price ?? 0);
    const sell = Number(row.sell_price ?? 0);
    return {
      id: Number(row.id),
      voucher_id: row.voucher_id === null ? null : Number(row.voucher_id),
      username: row.username ? String(row.username) : null,
      profile_name: String(row.profile_name ?? ''),
      profile_type: (row.profile_type ?? 'hotspot') as 'hotspot' | 'ppp',
      quantity,
      cost_price: cost,
      sell_price: sell,
      total_cost: cost * quantity,
      total_sell: sell * quantity,
      margin: (sell - cost) * quantity,
      owner_id: row.owner_id === null ? null : Number(row.owner_id),
      owner_name: row.owner_name ? String(row.owner_name) : null,
      recorded_by: row.recorded_by === null ? null : Number(row.recorded_by),
      recorded_by_name: row.recorded_by_name ? String(row.recorded_by_name) : null,
      buyer_name: row.buyer_name ? String(row.buyer_name) : null,
      method: String(row.method ?? 'cash'),
      note: row.note ? String(row.note) : null,
      sold_at: new Date(row.sold_at).toISOString(),
      voided_at: row.voided_at ? new Date(row.voided_at).toISOString() : null,
      void_reason: row.void_reason ? String(row.void_reason) : null,
    };
  }
}
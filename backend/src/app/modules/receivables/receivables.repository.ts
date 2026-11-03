import { Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { RequestScope } from '../auth/request-scope';

/**
 * Piutang pelanggan — TIDAK ada tabel baru.
 *
 * Saldo = sisa tagihan pada `invoices` yang belum lunas dan belum void,
 * dikurangi pembayaran sah (`payments.voided_at IS NULL`). Tagihan `paid`
 * otomatis bersaldo 0 dan tagihan `void` tidak dihitung sama sekali.
 */

const BALANCE_SUBQUERY = `
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS paid
      FROM payments
     WHERE voided_at IS NULL
     GROUP BY invoice_id
  ) p ON p.invoice_id = i.id`;

export interface ReceivableInvoice {
  id: number;
  invoice_number: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  due_date: string;
  period_start: string | null;
  period_end: string | null;
  days_late: number;
}

export interface ReceivableBalance {
  outstanding: number;
  limit: number;
  remaining: number;
  open_invoices: number;
  overdue: number;
  not_due: number;
}

export type AgingBucket = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'over_90';

export interface ReceivableRow extends ReceivableInvoice {
  customer_id: number;
  customer_name: string;
  internet_no: string | null;
  owner_id: number | null;
  owner_name: string | null;
  profile_type: string | null;
  bucket: AgingBucket;
}

export interface ReceivableReportQuery {
  from?: string;
  to?: string;
  due_from?: string;
  due_to?: string;
  search?: string;
  owner_id?: number;
  profile_type?: 'hotspot' | 'ppp';
  status?: 'unpaid' | 'partial';
  page?: number;
  limit?: number;
}

export function agingBucket(daysLate: number): AgingBucket {
  if (daysLate <= 0) return 'not_due';
  if (daysLate <= 30) return 'd1_30';
  if (daysLate <= 60) return 'd31_60';
  if (daysLate <= 90) return 'd61_90';
  return 'over_90';
}

const toDateOnly = (value: unknown): string => {
  if (value instanceof Date) {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
};

@Injectable()
export class ReceivablesRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Saldo piutang satu pelanggan. `conn` dipakai saat pemanggil sudah memegang
   * transaksi (perpanjangan dengan piutang) supaya pemeriksaan limit dan
   * pembuatan tagihan berada di langkah yang sama.
   */
  async balance(
    customerId: number,
    conn?: PoolConnection,
  ): Promise<{ outstanding: number; limit: number; invoices: ReceivableInvoice[] }> {
    const sql = `SELECT i.id, i.invoice_number, i.amount, COALESCE(p.paid, 0) AS paid,
              GREATEST(i.amount - COALESCE(p.paid, 0), 0) AS balance,
              i.status, i.due_date, i.period_start, i.period_end,
              DATEDIFF(CURDATE(), i.due_date) AS days_late
         FROM invoices i ${BALANCE_SUBQUERY}
        WHERE i.customer_id = ? AND i.status NOT IN ('paid', 'void')
        ORDER BY i.due_date ASC, i.id ASC`;

    // PoolConnection dan DatabaseService punya signature query berbeda; pilih
    // jalur sesuai pemanggil, bukan menyatukan tipe.
    const rows: RowDataPacket[] = conn
      ? (await conn.query<RowDataPacket[]>(sql, [customerId]))[0]
      : await this.db.query<RowDataPacket>(sql, [customerId]);

    const limitRows: RowDataPacket[] = conn
      ? (await conn.query<RowDataPacket[]>('SELECT credit_limit FROM customers WHERE id = ?', [customerId]))[0]
      : await this.db.query<RowDataPacket>('SELECT credit_limit FROM customers WHERE id = ?', [customerId]);

    const invoices: ReceivableInvoice[] = rows.map((row: RowDataPacket) => ({
      id: Number(row.id),
      invoice_number: String(row.invoice_number),
      amount: Number(row.amount),
      paid: Number(row.paid),
      balance: Number(row.balance),
      status: String(row.status),
      due_date: toDateOnly(row.due_date),
      period_start: row.period_start ? toDateOnly(row.period_start) : null,
      period_end: row.period_end ? toDateOnly(row.period_end) : null,
      days_late: Number(row.days_late ?? 0),
    }));

    const outstanding =
      Math.round(invoices.reduce((sum, invoice) => sum + invoice.balance, 0) * 100) / 100;

    return {
      outstanding,
      limit: Number(limitRows[0]?.credit_limit ?? 0),
      invoices,
    };
  }

  async invoicesOf(customerId: number): Promise<ReceivableInvoice[]> {
    const { invoices } = await this.balance(customerId);
    return invoices;
  }

  /** Laporan piutang + aging; seluruh filter dan cakupan diterapkan di SQL. */
  async report(
    query: ReceivableReportQuery,
    scope: RequestScope,
  ): Promise<{ rows: ReceivableRow[]; total: number; page: number; limit: number }> {
    const where: string[] = ["i.status NOT IN ('paid', 'void')"];
    const params: unknown[] = [];

    // Cakupan reseller: hanya pelanggan miliknya. Fail-closed.
    if (scope.isReseller) {
      if (!scope.ownerId || scope.ownerId <= 0) {
        return { rows: [], total: 0, page: 1, limit: 20 };
      }
      where.push('c.owner_id = ?');
      params.push(scope.ownerId);
    }
    if (query.owner_id) {
      where.push('c.owner_id = ?');
      params.push(query.owner_id);
    }
    if (query.from) {
      where.push('i.created_at >= ?');
      params.push(`${query.from} 00:00:00`);
    }
    if (query.to) {
      where.push('i.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(query.to);
    }
    if (query.due_from) {
      where.push('i.due_date >= ?');
      params.push(query.due_from);
    }
    if (query.due_to) {
      where.push('i.due_date <= ?');
      params.push(query.due_to);
    }
    if (query.status) {
      where.push('i.status = ?');
      params.push(query.status);
    }
    if (query.profile_type) {
      where.push('v.profile_type = ?');
      params.push(query.profile_type);
    }
    if (query.search) {
      where.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.internet_no LIKE ?)');
      const needle = `%${query.search}%`;
      params.push(needle, needle, needle);
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 200);
    const whereSql = where.join(' AND ');
    const joins = `
      JOIN customers c ON c.id = i.customer_id
      LEFT JOIN users o ON o.id = c.owner_id
      LEFT JOIN radius_vouchers v ON v.username = i.username`;

    const countRow = await this.db.queryOne<RowDataPacket & { total: number | string }>(
      `SELECT COUNT(*) AS total
         FROM invoices i ${BALANCE_SUBQUERY} ${joins}
        WHERE ${whereSql} AND (i.amount - COALESCE(p.paid, 0)) > 0`,
      params,
    );

    const rows = await this.db.query<RowDataPacket>(
      `SELECT i.id, i.invoice_number, i.amount, COALESCE(p.paid, 0) AS paid,
              GREATEST(i.amount - COALESCE(p.paid, 0), 0) AS balance,
              i.status, i.due_date, i.period_start, i.period_end,
              DATEDIFF(CURDATE(), i.due_date) AS days_late,
              c.id AS customer_id, c.name AS customer_name, c.internet_no,
              c.owner_id, o.name AS owner_name, v.profile_type
         FROM invoices i ${BALANCE_SUBQUERY} ${joins}
        WHERE ${whereSql} AND (i.amount - COALESCE(p.paid, 0)) > 0
        ORDER BY i.due_date ASC, i.id ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );

    return {
      rows: rows.map((row) => {
        const daysLate = Number(row.days_late ?? 0);
        return {
          id: Number(row.id),
          invoice_number: String(row.invoice_number),
          amount: Number(row.amount),
          paid: Number(row.paid),
          balance: Number(row.balance),
          status: String(row.status),
          due_date: toDateOnly(row.due_date),
          period_start: row.period_start ? toDateOnly(row.period_start) : null,
          period_end: row.period_end ? toDateOnly(row.period_end) : null,
          days_late: daysLate,
          customer_id: Number(row.customer_id),
          customer_name: String(row.customer_name),
          internet_no: row.internet_no === null ? null : String(row.internet_no),
          owner_id: row.owner_id === null ? null : Number(row.owner_id),
          owner_name: row.owner_name === null ? null : String(row.owner_name),
          profile_type: row.profile_type === null ? null : String(row.profile_type),
          bucket: agingBucket(daysLate),
        };
      }),
      total: Number(countRow?.total ?? 0),
      page,
      limit,
    };
  }

  /** Ringkasan piutang untuk dashboard: total, jatuh tempo, belum jatuh tempo. */
  async summary(scope: RequestScope): Promise<{
    outstanding: number;
    overdue: number;
    not_due: number;
    open_invoices: number;
    paid_invoices: number;
  }> {
    const params: unknown[] = [];
    let scopeSql = '';
    if (scope.isReseller) {
      if (!scope.ownerId || scope.ownerId <= 0) {
        return { outstanding: 0, overdue: 0, not_due: 0, open_invoices: 0, paid_invoices: 0 };
      }
      scopeSql = ' AND c.owner_id = ?';
      params.push(scope.ownerId);
    }

    const row = await this.db.queryOne<Record<string, number | string>>(
      `SELECT COALESCE(SUM(t.balance), 0) AS outstanding,
              COALESCE(SUM(IF(t.days_late > 0, t.balance, 0)), 0) AS overdue,
              COALESCE(SUM(IF(t.days_late <= 0, t.balance, 0)), 0) AS not_due,
              COUNT(*) AS open_invoices
         FROM (
           SELECT GREATEST(i.amount - COALESCE(p.paid, 0), 0) AS balance,
                  DATEDIFF(CURDATE(), i.due_date) AS days_late
             FROM invoices i ${BALANCE_SUBQUERY}
             JOIN customers c ON c.id = i.customer_id
            WHERE i.status NOT IN ('paid', 'void')${scopeSql}
         ) t
        WHERE t.balance > 0`,
      params,
    );

    const paid = await this.db.queryOne<RowDataPacket & { total: number | string }>(
      `SELECT COUNT(*) AS total
         FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.status = 'paid'${scopeSql}`,
      params,
    );

    return {
      outstanding: Number(row?.outstanding ?? 0),
      overdue: Number(row?.overdue ?? 0),
      not_due: Number(row?.not_due ?? 0),
      open_invoices: Number(row?.open_invoices ?? 0),
      paid_invoices: Number(paid?.total ?? 0),
    };
  }

  async customerInScope(customerId: number, scope: RequestScope): Promise<{
    id: number;
    name: string;
    internet_no: string | null;
    credit_limit: number;
    owner_id: number | null;
  } | null> {
    const params: unknown[] = [customerId];
    let ownerSql = '';
    if (scope.isReseller) {
      if (!scope.ownerId || scope.ownerId <= 0) return null;
      ownerSql = ' AND owner_id = ?';
      params.push(scope.ownerId);
    }
    const rows = await this.db.query<RowDataPacket>(
      `SELECT id, name, internet_no, credit_limit, owner_id
         FROM customers WHERE id = ?${ownerSql}`,
      params,
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: Number(row.id),
      name: String(row.name),
      internet_no: row.internet_no === null ? null : String(row.internet_no),
      credit_limit: Number(row.credit_limit ?? 0),
      owner_id: row.owner_id === null ? null : Number(row.owner_id),
    };
  }

  async setCreditLimit(customerId: number, limit: number): Promise<void> {
    await this.db.execute('UPDATE customers SET credit_limit = ? WHERE id = ?', [limit, customerId]);
  }
}
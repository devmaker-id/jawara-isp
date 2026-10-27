import { Injectable } from '@nestjs/common';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { ownerFilter, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { CreatePaymentDto, PaymentMethod } from './dto/payment.dto';
import { nextInvoiceState } from './payments.domain';

export type PaymentErrorCode =
  | 'INVOICE_NOT_FOUND'
  | 'PAYMENT_NOT_FOUND'
  | 'ALREADY_PAID'
  | 'OVERPAY'
  | 'IDEMPOTENT_VOIDED'
  | 'ALREADY_VOIDED'
  | 'VOID_REASON_REQUIRED';

// Kesalahan domain pembayaran. Dilempar dari dalam transaksi agar rollback
// terjadi sebelum service menerjemahkannya menjadi respons HTTP.
export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
    readonly remaining?: number,
    readonly paymentId?: number,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export interface PaymentActor {
  id: number;
  email: string;
  name: string;
  ip: string;
}

export interface Payment {
  id: number;
  invoice_id: number;
  invoice_number: string;
  customer_name: string;
  invoice_status: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paid_at: string;
  recorded_by: number | null;
  recorded_by_name: string | null;
  note: string;
  idempotency_key: string | null;
  voided_at: string | null;
  voided_by: number | null;
  void_reason: string | null;
  created_at: Date;
}

// Ringkasan tagihan setelah mutasi: status tersimpan (unpaid/partial/paid)
// dan tanggal lunas. Overdue tetap diturunkan saat baca oleh modul invoices.
export interface InvoiceBrief {
  id: number;
  status: string;
  paid_date: string | null;
}

export interface PaymentFilters {
  search?: string;
  from?: string;
  to?: string;
  method?: PaymentMethod;
  // valid = belum di-void, void = hanya yang dibatalkan, all = keduanya
  status?: 'valid' | 'void' | 'all';
  invoiceId?: number;
}

export interface PaymentPage {
  rows: Payment[];
  total: number;
  page: number;
  limit: number;
}

export interface LedgerSummary {
  // pemasukan pada periode (hanya pembayaran sah)
  income: number;
  transactions: number;
  // saldo saat ini, bukan pemasukan periode
  outstanding: number;
  overdue: number;
}

export interface InvoiceBalance {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  paid_total: number;
  remaining: number;
  due_date: string;
  status: string;
  overdue: boolean;
}

export interface MethodTotal {
  method: PaymentMethod;
  transactions: number;
  total: number;
}

export interface PaymentResult {
  payment: Payment;
  invoice: InvoiceBrief;
  // false = baris lama dari kunci idempoten yang dikirim ulang (HTTP 200).
  created: boolean;
}

interface PaymentRow extends RowDataPacket {
  id: number;
  invoice_id: number;
  invoice_number: string;
  customer_name: string;
  invoice_status: string;
  amount: number | string;
  method: string;
  reference: string | null;
  paid_at: Date | string;
  recorded_by: number | null;
  recorded_by_name: string | null;
  note: string;
  idempotency_key: string | null;
  voided_at: Date | string | null;
  voided_by: number | null;
  void_reason: string | null;
  created_at: Date;
}

interface InvoiceBriefRow extends RowDataPacket {
  id: number;
  amount: number | string;
  status: string;
  paid_date: Date | string | null;
}

const PAYMENT_COLUMNS = `p.id, p.invoice_id, i.invoice_number, i.customer_name, i.status AS invoice_status,
  p.amount, p.method, p.reference, p.paid_at, p.recorded_by, u.name AS recorded_by_name, p.note,
  p.idempotency_key, p.voided_at, p.voided_by, p.void_reason, p.created_at`;

const PAYMENT_FROM = `FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  LEFT JOIN users u ON u.id = p.recorded_by`;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function toDateOnly(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDateTime(value: Date | string): string {
  if (typeof value === 'string') return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    customer_name: row.customer_name,
    invoice_status: row.invoice_status,
    amount: typeof row.amount === 'string' ? Number(row.amount) : row.amount,
    method: row.method as PaymentMethod,
    reference: row.reference,
    paid_at: toDateTime(row.paid_at),
    recorded_by: row.recorded_by,
    recorded_by_name: row.recorded_by_name,
    note: row.note,
    idempotency_key: row.idempotency_key,
    voided_at: row.voided_at === null ? null : toDateTime(row.voided_at),
    voided_by: row.voided_by,
    void_reason: row.void_reason,
    created_at: row.created_at,
  };
}

function toBrief(row: InvoiceBriefRow): InvoiceBrief {
  return { id: row.id, status: row.status, paid_date: toDateOnly(row.paid_date) };
}

function isDuplicate(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ER_DUP_ENTRY';
}

// Klausa WHERE dipakai bersama oleh riwayat, ringkasan, dan laporan agar
// aturan filter tidak bercabang di banyak tempat.
function filterClause(
  filters: PaymentFilters,
  scope: RequestScope = SYSTEM_SCOPE,
): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  // Scope reseller (identity dari token) masuk ke klausa WHERE yang sama,
  // sehingga riwayat, ringkasan, dan laporan tidak bisa berbeda cakupan.
  const owner = ownerFilter(scope, 'payments');
  if (owner.sql) {
    parts.push(owner.sql);
    params.push(...owner.params);
  }

  if (filters.invoiceId !== undefined) {
    parts.push('p.invoice_id = ?');
    params.push(filters.invoiceId);
  }
  if (filters.from) {
    parts.push('p.paid_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    parts.push('p.paid_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(filters.to);
  }
  if (filters.method) {
    parts.push('p.method = ?');
    params.push(filters.method);
  }
  if (filters.status === 'valid') parts.push('p.voided_at IS NULL');
  else if (filters.status === 'void') parts.push('p.voided_at IS NOT NULL');

  if (filters.search) {
    parts.push(
      '(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR p.reference LIKE ? OR p.note LIKE ?)',
    );
    const like = `%${filters.search}%`;
    params.push(like, like, like, like);
  }

  return { sql: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '', params };
}

@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async listByInvoice(
    invoiceId: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<Payment[]> {
    const owner = ownerFilter(scope, 'payments');
    const clause = owner.sql ? ` AND ${owner.sql}` : '';
    const rows = await this.db.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} WHERE p.invoice_id = ?${clause}
       ORDER BY p.paid_at DESC, p.id DESC`,
      [invoiceId, ...owner.params],
    );
    return rows.map(toPayment);
  }

  // ===== Query lintas tagihan: riwayat, ringkasan, dan laporan =====
  // Semua angka dihitung database; frontend tidak pernah menjumlahkan sendiri.
  async search(
    filters: PaymentFilters,
    page: number,
    limit: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<PaymentPage> {
    const where = filterClause(filters, scope);
    const rows = await this.db.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} ${where.sql}
       ORDER BY p.paid_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [...where.params, limit, (page - 1) * limit],
    );
    const totalRow = await this.db.queryOne<RowDataPacket & { total: number | string }>(
      `SELECT COUNT(*) AS total ${PAYMENT_FROM} ${where.sql}`,
      where.params,
    );
    return {
      rows: rows.map(toPayment),
      total: Number(totalRow?.total ?? 0),
      page,
      limit,
    };
  }

  // Pemasukan periode: HANYA pembayaran sah (voided_at IS NULL), berdasarkan
  // tanggal pembayaran (paid_at), bukan tanggal dibuat/diubah.
  async incomeOf(
    from?: string,
    to?: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ income: number; transactions: number }> {
    const { sql, params } = filterClause({ from, to, status: 'valid' }, scope);
    const row = await this.db.queryOne<(RowDataPacket & { income: number | string; transactions: number | string })>(
      `SELECT COALESCE(SUM(p.amount), 0) AS income, COUNT(*) AS transactions
       ${PAYMENT_FROM} ${sql}`,
      params,
    );
    return {
      income: Number(row?.income ?? 0),
      transactions: Number(row?.transactions ?? 0),
    };
  }

  // Saldo tagihan saat ini (bukan pemasukan periode): sisa = nominal - SUM sah.
  // Tunggakan = sisa pada tagihan yang due_date-nya sudah lewat.
  async outstanding(
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ outstanding: number; overdue: number }> {
    const owner = ownerFilter(scope, 'payments');
    const innerWhere = owner.sql ? ` WHERE ${owner.sql}` : '';
    const row = await this.db.queryOne<
      RowDataPacket & { outstanding: number | string; overdue: number | string }
    >(
      `SELECT
         COALESCE(SUM(CASE WHEN t.paid < t.amount THEN t.amount - t.paid ELSE 0 END), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN t.paid < t.amount AND t.due_date < CURDATE()
                           THEN t.amount - t.paid ELSE 0 END), 0) AS overdue
       FROM (
         SELECT i.id, i.amount, i.due_date,
                COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount ELSE 0 END), 0) AS paid
         FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
         ${innerWhere}
         GROUP BY i.id, i.amount, i.due_date
       ) t`,
      owner.params,
    );
    return {
      outstanding: Number(row?.outstanding ?? 0),
      overdue: Number(row?.overdue ?? 0),
    };
  }

  async methodTotals(
    from?: string,
    to?: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<MethodTotal[]> {
    const { sql, params } = filterClause({ from, to, status: 'valid' }, scope);
    const rows = await this.db.query<
      RowDataPacket & { method: string; transactions: number | string; total: number | string }
    >(
      `SELECT p.method, COUNT(*) AS transactions, COALESCE(SUM(p.amount), 0) AS total
       ${PAYMENT_FROM} ${sql} GROUP BY p.method ORDER BY total DESC`,
      params,
    );
    return rows.map((row) => ({
      method: row.method as PaymentMethod,
      transactions: Number(row.transactions),
      total: Number(row.total),
    }));
  }

  // Tagihan yang masih bersisa (untuk pilihan invoice pada form pembayaran).
  async payableInvoices(
    search: string | undefined,
    page: number,
    limit: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ rows: InvoiceBalance[]; total: number }> {
    const like = search ? `%${search}%` : null;
    const parts: string[] = [];
    const params: unknown[] = [];
    if (like) {
      parts.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ?)');
      params.push(like, like);
    }
    const owner = ownerFilter(scope, 'payments');
    if (owner.sql) {
      parts.push(owner.sql);
      params.push(...owner.params);
    }
    const where = parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '';

    const rows = await this.db.query<
      RowDataPacket & {
        id: number;
        invoice_number: string;
        customer_name: string;
        amount: number | string;
        paid_total: number | string;
        due_date: Date | string;
        status: string;
      }
    >(
      `SELECT i.id, i.invoice_number, i.customer_name, i.amount, i.due_date, i.status,
              COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount ELSE 0 END), 0) AS paid_total
       FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
       ${where}
       GROUP BY i.id, i.invoice_number, i.customer_name, i.amount, i.due_date, i.status
       HAVING paid_total < i.amount
       ORDER BY i.due_date ASC, i.id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );

    const totalRow = await this.db.queryOne<RowDataPacket & { total: number | string }>(
      `SELECT COUNT(*) AS total FROM (
         SELECT i.id FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
         ${where}
         GROUP BY i.id, i.amount
         HAVING COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount ELSE 0 END), 0) < i.amount
       ) t`,
      params,
    );

    const today = toDateOnly(new Date()) as string;
    return {
      rows: rows.map((row) => {
        const amount = Number(row.amount);
        const paid = Number(row.paid_total);
        const dueDate = toDateOnly(row.due_date) ?? '';
        return {
          id: row.id,
          invoice_number: row.invoice_number,
          customer_name: row.customer_name,
          amount,
          paid_total: paid,
          remaining: round2(amount - paid),
          due_date: dueDate,
          status: row.status,
          overdue: dueDate < today && paid < amount,
        };
      }),
      total: Number(totalRow?.total ?? 0),
    };
  }

  // Satu transaksi per pembayaran: kunci baris tagihan (FOR UPDATE) → cek
  // kunci idempoten → SUM pembayaran sah → validasi sisa → INSERT → hitung
  // ulang status tagihan. Permintaan bersamaan mengantre pada kunci baris.
  async create(
    invoiceId: number,
    dto: CreatePaymentDto,
    actor: PaymentActor,
  ): Promise<PaymentResult> {
    return this.db.withTransaction(async (conn) => {
      const invoice = await this.lockInvoice(conn, invoiceId);
      if (!invoice) {
        throw new PaymentError('INVOICE_NOT_FOUND', `Tagihan dengan ID ${invoiceId} tidak ditemukan`);
      }

      if (dto.idempotency_key) {
        const existing = await this.findByKey(conn, invoiceId, dto.idempotency_key);
        if (existing) {
          this.rejectVoided(existing);
          return {
            payment: existing,
            invoice: await this.invoiceBrief(conn, invoiceId),
            created: false,
          };
        }
      }

      const paid = await this.paidTotal(conn, invoiceId);
      const remaining = round2(invoice.amount - paid);
      if (remaining <= 0) {
        throw new PaymentError('ALREADY_PAID', 'Tagihan sudah lunas', 0);
      }
      const amount = round2(dto.amount);
      if (amount > remaining) {
        throw new PaymentError(
          'OVERPAY',
          `Nominal pembayaran melebihi sisa tagihan (sisa ${remaining})`,
          remaining,
        );
      }

      let insertId: number;
      try {
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO payments (invoice_id, amount, method, reference, paid_at, recorded_by, note, idempotency_key)
           VALUES (?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?)`,
          [
            invoiceId,
            amount,
            dto.method ?? PaymentMethod.CASH,
            dto.reference?.trim() || null,
            dto.paid_at ?? null,
            actor.id,
            dto.note?.trim() ?? '',
            dto.idempotency_key ?? null,
          ],
        );
        insertId = result.insertId;
      } catch (error) {
        // Jaring pengaman UNIQUE(invoice_id, idempotency_key): kirim ulang
        // kunci yang sama tidak boleh menjadi tagihan kedua.
        if (!isDuplicate(error) || !dto.idempotency_key) throw error;
        const existing = await this.findByKey(conn, invoiceId, dto.idempotency_key);
        if (!existing) throw error;
        this.rejectVoided(existing);
        return {
          payment: existing,
          invoice: await this.invoiceBrief(conn, invoiceId),
          created: false,
        };
      }

      await this.applyInvoiceState(conn, invoiceId);
      return {
        payment: await this.requirePayment(conn, insertId),
        invoice: await this.invoiceBrief(conn, invoiceId),
        created: true,
      };
    });
  }

  // Pembayaran tidak pernah dihapus: koreksi lewat void (alasan wajib,
  // khusus admin) yang menulis jejak audit dan menghitung ulang status.
  async void(id: number, reason: string, actor: PaymentActor): Promise<PaymentResult> {
    return this.db.withTransaction(async (conn) => {
      const [rows] = await conn.query<PaymentRow[]>(
        `SELECT id, invoice_id, amount, voided_at FROM payments WHERE id = ? FOR UPDATE`,
        [id],
      );
      const payment = rows[0];
      if (!payment) {
        throw new PaymentError('PAYMENT_NOT_FOUND', `Pembayaran dengan ID ${id} tidak ditemukan`);
      }
      if (payment.voided_at !== null) {
        throw new PaymentError('ALREADY_VOIDED', 'Pembayaran sudah dibatalkan', undefined, id);
      }
      if (reason.trim().length === 0) {
        throw new PaymentError('VOID_REASON_REQUIRED', 'Alasan void wajib diisi', undefined, id);
      }

      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE payments SET voided_at = NOW(), voided_by = ?, void_reason = ?
         WHERE id = ? AND voided_at IS NULL`,
        [actor.id, reason.trim(), id],
      );
      if (result.affectedRows === 0) {
        throw new PaymentError('ALREADY_VOIDED', 'Pembayaran sudah dibatalkan', undefined, id);
      }

      await this.writeVoidAudit(conn, actor, id, payment.invoice_id, Number(payment.amount), reason.trim());
      await this.applyInvoiceState(conn, payment.invoice_id);

      return {
        payment: await this.requirePayment(conn, id),
        invoice: await this.invoiceBrief(conn, payment.invoice_id),
        created: false,
      };
    });
  }

  private rejectVoided(payment: Payment): void {
    if (payment.voided_at !== null) {
      throw new PaymentError(
        'IDEMPOTENT_VOIDED',
        `Pembayaran dengan kunci ini sudah dibatalkan (ID ${payment.id}); buat pembayaran baru dengan kunci berbeda`,
        undefined,
        payment.id,
      );
    }
  }

  // Status tagihan SELALU dihitung ulang dari SUM pembayaran sah, termasuk
  // saat void membuat tagihan kembali unpaid/partial.
  private async applyInvoiceState(conn: PoolConnection, invoiceId: number): Promise<void> {
    const invoice = await this.lockInvoice(conn, invoiceId);
    if (!invoice) return;

    const status = nextInvoiceState(invoice.amount, await this.paidTotal(conn, invoiceId));
    const paidDate: string | null =
      status === 'paid' ? await this.lastPaidDate(conn, invoiceId) : null;

    await conn.query('UPDATE invoices SET status = ?, paid_date = ? WHERE id = ?', [
      status,
      paidDate,
      invoiceId,
    ]);

    await this.syncAccountState(conn, invoiceId, status);
  }

  /**
   * Menyambungkan uang ke akun RADIUS.
   *
   * Tagihan yang menunjuk `username` mengendalikan status akun itu:
   *   lunas            → 'new-created' menjadi 'ready-to-use' (voucher) atau
   *                      'active' (customer/member)
   *   tidak lagi lunas → kembali 'new-created' HANYA bila akun belum pernah
   *                      login; akun yang sudah dipakai tidak dicabut mundur.
   *
   * Status lain ('expired', atau yang sudah dipakai) tidak pernah diturunkan
   * di sini — pembatalan masa aktif bukan urusan pembayaran.
   */
  private async syncAccountState(
    conn: PoolConnection,
    invoiceId: number,
    status: string,
  ): Promise<void> {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT username FROM invoices WHERE id = ?',
      [invoiceId],
    );
    const username = (rows[0]?.username as string | null) ?? null;
    if (!username) return;

    if (status === 'paid') {
      await conn.query(
        `UPDATE radius_vouchers
            SET status = IF(user_type = 'voucher', 'ready-to-use', 'active')
          WHERE username = ? AND status = 'new-created'`,
        [username],
      );

      // Lunas = keluar dari isolir. Grup dikembalikan ke profil aslinya supaya
      // pelanggan PPPoE tidak tertahan di 10.127.0.0/18 setelah membayar.
      // Blokir waktu/kuota TIDAK dilepas di sini: kalau batasnya memang habis,
      // penegak akan mengisolasinya lagi pada putaran berikutnya.
      const [isolir] = await conn.query<RowDataPacket[]>(
        'SELECT isolir_at FROM radius_vouchers WHERE username = ?',
        [username],
      );
      if (isolir[0]?.isolir_at) {
        const [target] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(h.radius_group, h.name, p.radius_group, p.name) AS groupname
             FROM radius_vouchers v
             LEFT JOIN hotspot_profiles h ON v.profile_type = 'hotspot' AND h.id = v.profile_id
             LEFT JOIN ppp_profiles p     ON v.profile_type = 'ppp'     AND p.id = v.profile_id
            WHERE v.username = ?`,
          [username],
        );
        const groupname = (target[0]?.groupname as string | null) ?? null;
        if (groupname) {
          await conn.query('DELETE FROM radusergroup WHERE username = ?', [username]);
          await conn.query(
            'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
            [username, groupname],
          );
          await conn.query(
            `UPDATE radius_vouchers
                SET status = 'active', block_reason = NULL, isolir_at = NULL
              WHERE username = ?`,
            [username],
          );
        }
      }
      return;
    }

    await conn.query(
      `UPDATE radius_vouchers
          SET status = 'new-created'
        WHERE username = ? AND status IN ('ready-to-use','active')
          AND first_login_at IS NULL`,
      [username],
    );
  }

  private async lockInvoice(
    conn: PoolConnection,
    invoiceId: number,
  ): Promise<{ id: number; amount: number } | null> {
    const [rows] = await conn.query<InvoiceBriefRow[]>(
      `SELECT id, amount FROM invoices WHERE id = ? FOR UPDATE`,
      [invoiceId],
    );
    const row = rows[0];
    return row ? { id: row.id, amount: Number(row.amount) } : null;
  }

  private async invoiceBrief(conn: PoolConnection, invoiceId: number): Promise<InvoiceBrief> {
    const [rows] = await conn.query<InvoiceBriefRow[]>(
      `SELECT id, status, paid_date FROM invoices WHERE id = ?`,
      [invoiceId],
    );
    if (!rows[0]) {
      throw new PaymentError('INVOICE_NOT_FOUND', `Tagihan dengan ID ${invoiceId} tidak ditemukan`);
    }
    return toBrief(rows[0]);
  }

  private async paidTotal(conn: PoolConnection, invoiceId: number): Promise<number> {
    const [rows] = await conn.query<(RowDataPacket & { total: number | string | null })[]>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
       WHERE invoice_id = ? AND voided_at IS NULL`,
      [invoiceId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  private async lastPaidDate(conn: PoolConnection, invoiceId: number): Promise<string | null> {
    const [rows] = await conn.query<(RowDataPacket & { last: Date | string | null })[]>(
      `SELECT MAX(paid_at) AS last FROM payments WHERE invoice_id = ? AND voided_at IS NULL`,
      [invoiceId],
    );
    return toDateOnly(rows[0]?.last ?? null);
  }

  private async findByKey(
    conn: PoolConnection,
    invoiceId: number,
    key: string,
  ): Promise<Payment | null> {
    const [rows] = await conn.query<PaymentRow[]>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
       WHERE p.invoice_id = ? AND p.idempotency_key = ?`,
      [invoiceId, key],
    );
    return rows[0] ? toPayment(rows[0]) : null;
  }

  private async requirePayment(conn: PoolConnection, id: number): Promise<Payment> {
    const [rows] = await conn.query<PaymentRow[]>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} WHERE p.id = ?`,
      [id],
    );
    if (!rows[0]) {
      throw new PaymentError('PAYMENT_NOT_FOUND', `Pembayaran dengan ID ${id} tidak ditemukan`);
    }
    return toPayment(rows[0]);
  }

  // Jejak audit void. Aktor di-snapshot ke details karena audit_logs.user_id
  // punya FK ON DELETE CASCADE: bila akun dihapus, barisnya hilang tetapi
  // salinan identitas pelaku di sini tetap terbaca (lihat migrasi 002).
  private async writeVoidAudit(
    conn: PoolConnection,
    actor: PaymentActor,
    paymentId: number,
    invoiceId: number,
    amount: number,
    reason: string,
  ): Promise<void> {
    const details = {
      payment_id: paymentId,
      invoice_id: invoiceId,
      amount,
      actor: { id: actor.id, email: actor.email, name: actor.name },
      reason,
    };
    await conn.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)`,
      [actor.id, 'PAYMENT_VOID', JSON.stringify(details), actor.ip.slice(0, 45)],
    );
  }
}

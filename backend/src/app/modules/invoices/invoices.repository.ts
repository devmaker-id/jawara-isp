import { Injectable } from '@nestjs/common';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { ownerFilter, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { writeFinanceEvent } from '../finance/finance-events.repository';
import { CreateInvoiceDto, InvoiceStatus, UpdateInvoiceDto } from './dto/invoice.dto';
import { invoiceSnapshot, validateInvoicePeriod } from './invoices.domain';

export type InvoiceErrorCode =
  | 'NOT_FOUND'
  | 'CUSTOMER_NOT_FOUND'
  | 'PAID_INVOICE_LOCKED'
  | 'INVALID_STATUS'
  | 'INVALID_PERIOD'
  | 'INVOICE_ALREADY_VOID'
  | 'INVOICE_HAS_PAYMENTS'
  | 'DELETE_FORBIDDEN';

// Pelaku perubahan tagihan. Disimpan ke audit_logs sebagai snapshot, mengikuti
// pola PaymentsService (migrasi 002: audit bertahan walau akun dihapus).
export interface InvoiceActor {
  id: number;
  email: string;
  name: string;
  ip: string;
}

// Kesalahan domain tagihan: service menerjemahkannya menjadi respons HTTP.
// Dilempar dari dalam transaksi agar rollback terjadi sebelum respons dikirim.
export class InvoiceError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    message: string,
    readonly remaining?: number,
  ) {
    super(message);
    this.name = 'InvoiceError';
  }
}

export interface Invoice {
  id: number;
  invoice_number: string;
  customer_id: number;
  /** Akun RADIUS yang ditagih; null untuk tagihan non-layanan. */
  username: string | null;
  customer_name: string;
  amount: number;
  status: InvoiceStatus;
  due_date: string;
  /** Periode penagihan; null untuk tagihan lama/non-layanan. */
  period_start: string | null;
  period_end: string | null;
  paid_date: string | null;
  description: string;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
}

export interface InvoiceSummary {
  total: number;
  paid: number;
  unpaid: number;
  overdue: number;
}

interface InvoiceRow extends RowDataPacket {
  id: number;
  invoice_number: string;
  customer_id: number;
  username: string | null;
  customer_name: string;
  // DECIMAL(12,2): mysql2 mengembalikan string bila decimalNumbers tidak aktif.
  amount: number | string;
  status: string;
  due_date: Date | string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  paid_date: Date | string | null;
  description: string;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
}

// Status "overdue" diturunkan dari due_date agar tidak perlu job pemelihara:
// unpaid yang lewat jatuh tempo ditampilkan sebagai overdue.
const STATUS_EXPR = `CASE WHEN status = 'unpaid' AND due_date < CURDATE() THEN 'overdue' ELSE status END AS status`;

const COLUMNS = `id, invoice_number, customer_id, username, customer_name, amount, ${STATUS_EXPR},
  due_date, period_start, period_end, paid_date, description, voided_at, void_reason, created_at`;

function toDateOnly(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    customer_id: row.customer_id,
    username: row.username ?? null,
    customer_name: row.customer_name,
    amount: typeof row.amount === 'string' ? Number(row.amount) : row.amount,
    status: row.status as InvoiceStatus,
    due_date: toDateOnly(row.due_date) ?? '',
    period_start: toDateOnly(row.period_start),
    period_end: toDateOnly(row.period_end),
    paid_date: toDateOnly(row.paid_date),
    description: row.description,
    voided_at: row.voided_at ?? null,
    void_reason: row.void_reason ?? null,
    created_at: row.created_at,
  };
}

export interface InvoiceQuery {
  search?: string;
  status?: 'unpaid' | 'paid' | 'overdue' | 'partial' | 'void';
  page?: number;
  limit?: number;
}

@Injectable()
export class InvoicesRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(scope: RequestScope = SYSTEM_SCOPE): Promise<Invoice[]> {
    const owner = ownerFilter(scope, 'invoices');
    const where = owner.sql ? ` WHERE ${owner.sql}` : '';
    const rows = await this.db.query<InvoiceRow>(
      `SELECT ${COLUMNS} FROM invoices${where} ORDER BY id DESC`,
      owner.params,
    );
    return rows.map(toInvoice);
  }

  // Pagination/pencarian di SQL. Catatan: filter status memakai kolom tersimpan
  // (`status`), bukan STATUS_EXPR turunan, agar COUNT dan LIMIT konsisten.
  async findPage(
    query: InvoiceQuery,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ rows: Invoice[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const search = query.search?.trim();

    // Scope reseller masuk ke SELECT dan COUNT lewat klausa yang sama.
    const owner = ownerFilter(scope, 'invoices');
    if (owner.sql) {
      where.push(owner.sql);
      params.push(...owner.params);
    }

    if (search) {
      where.push('(invoice_number LIKE ? OR customer_name LIKE ? OR username LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }

    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const totalRow = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM invoices${clause}`,
      params,
    );

    const listParams = [...params];
    let sql = `SELECT ${COLUMNS} FROM invoices${clause} ORDER BY id DESC`;
    if (query.limit !== undefined) {
      const limit = Math.max(1, Math.min(1000, Math.trunc(query.limit)));
      const page = Math.max(1, Math.trunc(query.page ?? 1));
      sql += ' LIMIT ? OFFSET ?';
      listParams.push(limit, (page - 1) * limit);
    }

    const rows = await this.db.query<InvoiceRow>(sql, listParams);
    return {
      rows: rows.map(toInvoice),
      total: totalRow ? Number(totalRow.total) : 0,
    };
  }

  async findById(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Invoice | null> {
    const owner = ownerFilter(scope, 'invoices');
    const clause = owner.sql ? ` AND ${owner.sql}` : '';
    const row = await this.db.queryOne<InvoiceRow>(
      `SELECT ${COLUMNS} FROM invoices WHERE id = ?${clause}`,
      [id, ...owner.params],
    );
    return row ? toInvoice(row) : null;
  }

  async findByCustomer(
    customerId: number,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<Invoice[]> {
    const owner = ownerFilter(scope, 'invoices');
    const clause = owner.sql ? ` AND ${owner.sql}` : '';
    const rows = await this.db.query<InvoiceRow>(
      `SELECT ${COLUMNS} FROM invoices WHERE customer_id = ?${clause} ORDER BY id DESC`,
      [customerId, ...owner.params],
    );
    return rows.map(toInvoice);
  }

  // Ringkasan ikut ter-scope: angka reseller tidak boleh memuat tagihan
  // reseller lain, dan total tidak boleh membocorkan keberadaan data itu.
  // Tagihan void (migrasi 032) tidak dihitung sebagai uang: dikeluarkan dari
  // total maupun hitungan status.
  async summary(scope: RequestScope = SYSTEM_SCOPE): Promise<InvoiceSummary> {
    const owner = ownerFilter(scope, 'invoices');
    const where = owner.sql ? ` WHERE ${owner.sql}` : '';
    const row = await this.db.queryOne<RowDataPacket & Record<string, number | string>>(
      `SELECT
         COALESCE(SUM(amount), 0) AS total,
         SUM(s = 'paid') AS paid,
         SUM(s = 'unpaid') AS unpaid,
         SUM(s = 'overdue') AS overdue
       FROM (SELECT amount, ${STATUS_EXPR.replace(' AS status', '')} AS s FROM invoices${where}) AS t
       WHERE s <> 'void'`,
      owner.params,
    );
    return {
      total: Number(row?.total ?? 0),
      paid: Number(row?.paid ?? 0),
      unpaid: Number(row?.unpaid ?? 0),
      overdue: Number(row?.overdue ?? 0),
    };
  }

  /**
   * Omzet periode = nilai invoice yang DITERBITKAN pada rentang tanggal
   * transaksi (`created_at`), bukan tanggal pembayaran dan bukan periode
   * layanan. Invoice void tidak dihitung. Berbeda dari kas masuk (payments).
   */
  async issued(
    from?: string,
    to?: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ total: number; count: number; voided: number; voided_count: number }> {
    const owner = ownerFilter(scope, 'invoices');
    const scopeSql = owner.sql ? ` AND ${owner.sql}` : '';
    const params: unknown[] = [...owner.params];

    // Tagihan DITERBITKAN: semua invoice yang dibuat pada rentang, termasuk
    // yang kemudian di-void pada periode berikutnya. Tanpa ini, laporan
    // periode lama berubah hanya karena ada pembatalan di bulan berikutnya.
    const created: string[] = [];
    if (from) {
      created.push('created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      created.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(to);
    }
    const issuedRow = await this.db.queryOne<
      RowDataPacket & { total: number | string; n: number | string }
    >(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
         FROM invoices
        WHERE ${created.length > 0 ? created.join(' AND ') : '1 = 1'}${scopeSql}`,
      params,
    );

    // PEMBATALAN: dihitung dari tanggal void, bukan tanggal invoice.
    const voidedParams: unknown[] = [...owner.params];
    const voided: string[] = ['voided_at IS NOT NULL'];
    if (from) {
      voided.push('voided_at >= ?');
      voidedParams.push(`${from} 00:00:00`);
    }
    if (to) {
      voided.push('voided_at < DATE_ADD(?, INTERVAL 1 DAY)');
      voidedParams.push(to);
    }
    const voidedRow = await this.db.queryOne<
      RowDataPacket & { total: number | string; n: number | string }
    >(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
         FROM invoices
        WHERE ${voided.join(' AND ')}${scopeSql}`,
      voidedParams,
    );

    return {
      total: Number(issuedRow?.total ?? 0),
      count: Number(issuedRow?.n ?? 0),
      voided: Number(voidedRow?.total ?? 0),
      voided_count: Number(voidedRow?.n ?? 0),
    };
  }

  /**
   * `conn` opsional dipakai pemanggil yang sudah memegang transaksi (mis.
   * perpanjangan dengan piutang yang harus memeriksa limit dan membuat tagihan
   * dalam satu langkah atomik). Tanpa `conn`, perilaku lama tetap: transaksi
   * sendiri.
   */
  async create(
    dto: CreateInvoiceDto,
    actor: InvoiceActor,
    conn?: PoolConnection,
  ): Promise<Invoice> {
    const periodError = validateInvoicePeriod(dto.period_start, dto.period_end);
    if (periodError) throw new InvoiceError('INVALID_PERIOD', periodError);

    if (conn) return this.insertInvoice(conn, dto, actor);
    return this.db.withTransaction((connection) => this.insertInvoice(connection, dto, actor));
  }

  private async insertInvoice(
    conn: PoolConnection,
    dto: CreateInvoiceDto,
    actor: InvoiceActor,
  ): Promise<Invoice> {
    {
      const customerName = await this.customerName(conn, dto.customer_id);
      const invoiceNumber = await this.nextInvoiceNumber(conn);

      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO invoices (invoice_number, customer_id, username, customer_name, amount, status, due_date,
                               period_start, period_end, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceNumber,
          dto.customer_id,
          dto.username?.trim() || null,
          customerName,
          dto.amount,
          dto.status ?? InvoiceStatus.UNPAID,
          dto.due_date,
          dto.period_start ?? null,
          dto.period_end ?? null,
          dto.description ?? '',
        ],
      );

      const created = await this.requireById(conn, result.insertId);
      // Event audit satu transaksi dengan INSERT: gagal audit = gagal tagihan.
      await writeFinanceEvent(conn, {
        entityType: 'invoice',
        entityId: created.id,
        action: 'INVOICE_CREATED',
        after: invoiceSnapshot(created),
        actor,
      });
      return created;
    }
  }

  async update(id: number, dto: UpdateInvoiceDto, actor: InvoiceActor): Promise<Invoice> {
    return this.db.withTransaction(async (conn) => {
      const current = await this.lock(conn, id);

      // Tagihan void bersifat final: tidak boleh diedit lagi.
      if (current.status === InvoiceStatus.VOID) {
        throw new InvoiceError('INVOICE_ALREADY_VOID', 'Tagihan sudah dibatalkan (void)');
      }
      // Tagihan lunas adalah catatan pembayaran: nominal dan jatuh tempo tidak
      // boleh diubah lagi (hanya deskripsi).
      if (current.status === InvoiceStatus.PAID && (dto.amount !== undefined || dto.due_date !== undefined)) {
        throw new InvoiceError(
          'PAID_INVOICE_LOCKED',
          'Tagihan sudah lunas: nominal dan jatuh tempo tidak dapat diubah',
        );
      }
      if (dto.status === InvoiceStatus.PAID || dto.status === InvoiceStatus.PARTIAL) {
        throw new InvoiceError(
          'INVALID_STATUS',
          'Status lunas/parsial hanya dapat diatur melalui endpoint pembayaran',
        );
      }
      if (dto.status === InvoiceStatus.VOID) {
        throw new InvoiceError('INVALID_STATUS', 'Gunakan endpoint void untuk membatalkan tagihan');
      }

      // Periode divalidasi sebagai satu kesatuan: nilai yang tidak dikirim
      // memakai nilai tersimpan, jadi mengubah salah satu ujung saja tetap
      // diperiksa terhadap pasangannya.
      const nextPeriodStart =
        dto.period_start !== undefined ? dto.period_start : current.period_start;
      const nextPeriodEnd = dto.period_end !== undefined ? dto.period_end : current.period_end;
      const periodError = validateInvoicePeriod(nextPeriodStart, nextPeriodEnd);
      if (periodError) throw new InvoiceError('INVALID_PERIOD', periodError);

      const fields: string[] = [];
      const params: unknown[] = [];

      if (dto.customer_id !== undefined && dto.customer_id !== current.customer_id) {
        fields.push('customer_id = ?', 'customer_name = ?');
        params.push(dto.customer_id, await this.customerName(conn, dto.customer_id));
      }
      if (dto.username !== undefined) {
        fields.push('username = ?');
        params.push(dto.username?.trim() || null);
      }
      if (dto.amount !== undefined) {
        fields.push('amount = ?');
        params.push(dto.amount);
      }
      if (dto.due_date !== undefined) {
        fields.push('due_date = ?');
        params.push(dto.due_date);
      }
      if (dto.period_start !== undefined) {
        fields.push('period_start = ?');
        params.push(dto.period_start ?? null);
      }
      if (dto.period_end !== undefined) {
        fields.push('period_end = ?');
        params.push(dto.period_end ?? null);
      }
      if (dto.description !== undefined) {
        fields.push('description = ?');
        params.push(dto.description);
      }
      if (dto.status !== undefined) {
        fields.push('status = ?');
        params.push(dto.status);
      }

      if (fields.length > 0) {
        params.push(id);
        await conn.query(`UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`, params);
      }

      const updated = await this.requireById(conn, id);
      await writeFinanceEvent(conn, {
        entityType: 'invoice',
        entityId: id,
        action: 'INVOICE_UPDATED',
        before: invoiceSnapshot(current),
        after: invoiceSnapshot(updated),
        actor,
      });
      return updated;
    });
  }

  // Pembatalan resmi menggantikan DELETE. Idempoten dalam arti: pembatalan
  // kedua ditolak dengan pesan jelas, bukan diam-diam diabaikan.
  async void(id: number, reason: string, actor: InvoiceActor): Promise<Invoice> {
    return this.db.withTransaction(async (conn) => {
      const current = await this.lock(conn, id);
      if (current.status === InvoiceStatus.VOID) {
        throw new InvoiceError(
          'INVOICE_ALREADY_VOID',
          `Tagihan ${current.invoice_number} sudah dibatalkan sebelumnya`,
        );
      }

      // Uang yang sudah masuk tidak boleh hilang karena tagihannya dibatalkan.
      // Koreksi dilakukan lewat void pembayaran (mekanisme yang sudah ada).
      const [rows] = await conn.query<(RowDataPacket & { n: number | string })[]>(
        `SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ? AND voided_at IS NULL`,
        [id],
      );
      if (Number(rows[0]?.n ?? 0) > 0) {
        throw new InvoiceError(
          'INVOICE_HAS_PAYMENTS',
          'Tagihan masih punya pembayaran sah. Batalkan (void) pembayarannya lebih dulu, ' +
            'lalu ulangi pembatalan tagihan.',
        );
      }

      await conn.query(
        `UPDATE invoices
            SET status = ?, voided_at = NOW(), voided_by = ?, void_reason = ?
          WHERE id = ?`,
        [InvoiceStatus.VOID, actor.id, reason.trim(), id],
      );

      const voided = await this.requireById(conn, id);
      await writeFinanceEvent(conn, {
        entityType: 'invoice',
        entityId: id,
        action: 'INVOICE_VOIDED',
        before: invoiceSnapshot(current),
        after: invoiceSnapshot(voided),
        reason,
        actor,
      });
      return voided;
    });
  }

  // DELETE fisik dihapus dari alur aplikasi: nomor tagihan tidak boleh bolong
  // dan relasi ke pembayaran tidak boleh lenyap tanpa jejak.
  async remove(): Promise<never> {
    throw new InvoiceError(
      'DELETE_FORBIDDEN',
      'Tagihan tidak dapat dihapus permanen. Gunakan pembatalan (void) dengan alasan ' +
        'agar nomor tagihan dan riwayatnya tetap tersimpan.',
    );
  }

  private async select(conn: PoolConnection, id: number, lock: boolean): Promise<Invoice | null> {
    const [rows] = await conn.query<InvoiceRow[]>(
      `SELECT ${COLUMNS} FROM invoices WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows.length > 0 ? toInvoice(rows[0]) : null;
  }

  private async lock(conn: PoolConnection, id: number): Promise<Invoice> {
    const invoice = await this.select(conn, id, true);
    if (!invoice) {
      throw new InvoiceError('NOT_FOUND', `Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return invoice;
  }

  private async requireById(conn: PoolConnection, id: number): Promise<Invoice> {
    const invoice = await this.select(conn, id, false);
    if (!invoice) {
      throw new InvoiceError('NOT_FOUND', `Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return invoice;
  }

  private async customerName(conn: PoolConnection, customerId: number): Promise<string> {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT name FROM customers WHERE id = ?',
      [customerId],
    );
    if (rows.length === 0) {
      throw new InvoiceError('CUSTOMER_NOT_FOUND', `Pelanggan dengan ID ${customerId} tidak ditemukan`);
    }
    return rows[0].name as string;
  }

  // Nomor tagihan: INV-<tahun>-<urut 4 digit>. SELECT ... FOR UPDATE menahan
  // baris terakhir pada rentang tahun berjalan; UNIQUE(invoice_number) menjadi
  // jaring pengaman terakhir bila dua permintaan benar-benar bersamaan.
  private async nextInvoiceNumber(conn: PoolConnection): Promise<string> {
    const year = new Date().getFullYear();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1 FOR UPDATE`,
      [`INV-${year}-%`],
    );
    const last = rows.length > 0 ? String(rows[0].invoice_number) : null;
    const lastSeq = last ? Number(last.split('-')[2]) : 0;
    const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
    return `INV-${year}-${String(seq).padStart(4, '0')}`;
  }
}
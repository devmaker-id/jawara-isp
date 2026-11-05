import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';

// Pembuat tagihan otomatis (siklus bulanan) + pengakuan pendapatan postpaid.
// Berjalan sebagai penjadwal interval; tiap run idempoten sehingga aman dijalankan
// ulang kapan saja (anti-ganda dijaga oleh UNIQUE (customer_id, username, period_key)).

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function clampDay(year: number, month: number, day: number): Date {
  return new Date(year, month, Math.min(day, daysInMonth(year, month)));
}

// Jatuh tempo bulanan berikutnya untuk billing_day (clamp ke akhir bulan).
// billing_day yang tersimpan tidak pernah diubah; di bulan pendek jatuh tempo = hari terakhir.
function nextDueDate(day: number, now: Date): Date {
  const thisMonth = clampDay(now.getFullYear(), now.getMonth(), day);
  if (thisMonth.getTime() >= startOfDay(now).getTime()) return thisMonth;
  return clampDay(now.getFullYear(), now.getMonth() + 1, day);
}

function addMonths(d: Date, n: number): Date {
  return clampDay(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));
}

function toDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface DueCustomer extends RowDataPacket {
  id: number;
  name: string;
  billing_type: 'prepaid' | 'postpaid';
  billing_day: number | null;
  next_billing_day: number | null;
  reg_day: number;
  username: string;
  price: number | string;
  tax_amount: number | string;
}

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private timer?: NodeJS.Timeout;
  // Interval pengecekan; default 1 jam (bisa disetel via env).
  private readonly intervalMs = Number(process.env.BILLING_INTERVAL_MS ?? 3_600_000);

  constructor(private readonly db: DatabaseService) {}

  onModuleInit() {
    if (!this.intervalMs || this.intervalMs < 60_000) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    void this.tick(); // jalankan sekali saat start supaya yang sudah jatuh tempo langsung tertagih
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const { created, recognized } = await this.run(new Date());
      if (created > 0 || recognized > 0) {
        this.logger.log(`Penagihan: ${created} tagihan dibuat, ${recognized} pendapatan diakui`);
      }
    } catch (error) {
      this.logger.warn(`Penagihan gagal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Satu putaran penuh (dipanggil penjadwal; bisa dipanggil manual untuk uji). */
  async run(now = new Date()): Promise<{ created: number; recognized: number }> {
    const created = await this.generateDueInvoices(now);
    const recognized = await this.recognizePostpaidRevenue(now);
    return { created, recognized };
  }

  private async leadDays(): Promise<number> {
    const raw = Number(process.env.BILLING_LEAD_DAYS ?? 5);
    return Number.isFinite(raw) && raw >= 0 ? raw : 5;
  }

  private async generateDueInvoices(now: Date): Promise<number> {
    const leadDays = await this.leadDays();
    const rows = await this.db.query<DueCustomer>(`
      SELECT c.id, c.name, c.billing_type, c.billing_day, c.next_billing_day, DAY(c.created_at) AS reg_day,
             v.username, v.price, v.tax_amount
        FROM customers c
        JOIN radius_vouchers v ON v.customer_id = c.id
       WHERE c.status = 'active' AND c.billing_type IS NOT NULL
    `);

    let created = 0;
    for (const row of rows) {
      // Perubahan tanggal tagihan yang menunggu (berlaku siklus berikutnya):
      // pakai tanggal baru untuk siklus yang mulai sekarang.
      const hasPending = row.next_billing_day !== null && row.next_billing_day !== undefined;
      const day = hasPending
        ? Number(row.next_billing_day)
        : Number(row.billing_day) || Number(row.reg_day) || 1;
      const due = nextDueDate(day, now);
      const diffDays = (startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS;
      // Hanya terbit dalam jendela "N hari sebelum jatuh tempo".
      if (diffDays < 0 || diffDays > leadDays) continue;

      // Siklus baru dimulai → promosikan perubahan tanggal & bersihkan penanda.
      if (hasPending) {
        await this.db.execute(
          'UPDATE customers SET billing_day = next_billing_day, next_billing_day = NULL WHERE id = ?',
          [row.id],
        );
      }

      const amount = Number(row.price ?? 0) + Number(row.tax_amount ?? 0);
      if (amount <= 0) continue;

      const periodStart = toDate(due);
      const periodEnd = toDate(addMonths(due, 1));
      const invoiceNumber = `INV-${periodStart.replace(/-/g, '')}-${randomBytes(2).toString('hex').toUpperCase()}`;

      try {
        await this.db.execute(
          `INSERT INTO invoices
             (invoice_number, customer_id, username, customer_name, amount, status, due_date, period_start, period_end, description)
           VALUES (?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)`,
          [
            invoiceNumber,
            row.id,
            row.username,
            row.name,
            amount,
            periodStart,
            periodStart,
            periodEnd,
            `Tagihan ${row.billing_type}`,
          ],
        );
        created += 1;
      } catch (error) {
        // UNIQUE (customer_id, username, period_key): periode sudah ditagih → lewati.
        if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') continue;
        throw error;
      }
    }

    return created;
  }

  private async recognizePostpaidRevenue(now: Date): Promise<number> {
    // Postpaid (accrual): pendapatan diakui saat masa pakai habis (period_end
    // lewat), terlepas dari sudah dibayar atau belum. Prepaid tidak lewat sini
    // (pendapatannya diakui saat pembayaran).
    const result = await this.db.execute(
      `UPDATE invoices i
         JOIN customers c ON c.id = i.customer_id
          SET i.revenue_recognized_at = NOW()
        WHERE c.billing_type = 'postpaid'
          AND i.revenue_recognized_at IS NULL
          AND i.status <> 'void'
          AND i.period_end IS NOT NULL AND i.period_end <= ?`,
      [toDate(now)],
    );
    return result ? Number(result.affectedRows ?? 0) : 0;
  }
}
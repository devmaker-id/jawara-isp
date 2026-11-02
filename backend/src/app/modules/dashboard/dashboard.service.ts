import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { SalesService } from '../sales/sales.service';
import { readServerMetrics, ServerMetrics } from './system-metrics';

// Ringkasan dashboard: uang, pelanggan, tagihan yang perlu ditindak, aktivitas
// terakhir, dan kondisi jaringan. Semua query baca-saja dan tidak memanggil API
// perangkat — dashboard dibuka sepanjang hari.
//
// Yang sengaja TIDAK ada di sini: log autentikasi RADIUS 24 jam, daftar akun
// hampir habis masa aktif, dan stok voucher per profil. Ketiganya data teknis
// operasional, bukan pertanyaan pertama admin saat membuka panel — dan dashboard
// yang memuat semuanya jadi tidak terbaca.

export interface DashboardSummary {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  /** Pendapatan hari ini = pembayaran tagihan + penjualan voucher. */
  today_revenue: number;
  today_payments: number;
  /** Rincian pendapatan harian & bulanan sesuai cakupan akun. */
  revenue: RevenueSnapshot;
  /** Sebaran pelanggan menurut status layanan. */
  customers: CustomerBreakdown;
  /** Piutang yang perlu ditagih, dengan daftar terlama. */
  receivable: ReceivableSnapshot;
  recent_payments: RecentPayment[];
  recent_invoices: RecentInvoice[];
  /** Kondisi inventori ONU dari sync OLT terakhir. */
  onu: OnuHealth;
  server: ServerMetrics;
  online: OnlineCounts;
}

/**
 * Angka pendapatan untuk kartu dashboard.
 *
 * `scope` dihitung di server: admin melihat seluruh pemilik/role, sedangkan
 * operator & reseller hanya melihat miliknya sendiri (lihat
 * VoucherSalesRepository.revenueFilter).
 */
export interface RevenueSnapshot {
  today: string;
  month_start: string;
  today_revenue: number;
  today_payments: number;
  today_vouchers: number;
  today_voucher_cost: number;
  today_margin: number;
  month_revenue: number;
  month_payments: number;
  month_vouchers: number;
  month_voucher_cost: number;
  month_margin: number;
  scope: 'all' | 'own';
}

const EMPTY_REVENUE: RevenueSnapshot = {
  today: '',
  month_start: '',
  today_revenue: 0,
  today_payments: 0,
  today_vouchers: 0,
  today_voucher_cost: 0,
  today_margin: 0,
  month_revenue: 0,
  month_payments: 0,
  month_vouchers: 0,
  month_voucher_cost: 0,
  month_margin: 0,
  scope: 'own',
};

export interface OnlineCounts {
  hotspot: number | null;
  ppp: number | null;
  /** Sesi hotspot yang memakai akun voucher (cetak). */
  hotspot_voucher: number | null;
  /** Sesi hotspot yang memakai akun member (pelanggan berlangganan). */
  hotspot_member: number | null;
  /** Sesi terbuka yang tidak bisa dipastikan hotspot atau PPP. */
  unclassified: number;
  device: string | null;
  error: string | null;
  /** 'radius' bila angka berasal dari radacct, 'device' bila terpaksa dari API. */
  source: 'radius' | 'device' | null;
}

/** Sebaran pelanggan menurut status (customers.status). */
export interface CustomerBreakdown {
  total: number;
  active: number;
  expired: number;
  suspend: number;
  disable: number;
}

/** Tagihan yang belum lunas dan sudah lewat jatuh tempo. */
export interface OverdueInvoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  /** Sisa tagihan setelah pembayaran sah. */
  amount: number;
  due_date: string;
  days_late: number;
}

export interface ReceivableSnapshot {
  overdue_count: number;
  overdue_total: number;
  /** Jatuh tempo dalam 7 hari ke depan (belum lewat). */
  due_soon_count: number;
  due_soon_total: number;
  /** Tagihan terlambat paling lama, maksimal 5 baris. */
  oldest: OverdueInvoice[];
}

export interface RecentPayment {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  method: string;
  paid_at: string;
  recorded_by_name: string | null;
}

export interface RecentInvoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  /** unpaid | overdue | partial | paid */
  status: string;
  due_date: string;
}

export interface OnuHealth {
  total: number;
  /** ONU yang tidak terlihat saat sync terakhir (kandidat LOS/putus). */
  missing: number;
  error: string | null;
}

interface BillingRow {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
}

const EMPTY_BILLING: BillingRow = {
  total_customers: 0,
  active_packages: 0,
  total_invoices: 0,
  unpaid_count: 0,
  unpaid_total: 0,
  today_revenue: 0,
  today_payments: 0,
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Status 'overdue' diturunkan dari due_date, sama seperti daftar tagihan; tidak
// ada job pemelihara yang mengubah status.
const STATUS_EXPR = `CASE WHEN i.status = 'unpaid' AND i.due_date < CURDATE() THEN 'overdue' ELSE i.status END`;

// Sisa tagihan per invoice: nominal dikurangi pembayaran yang tidak dibatalkan.
const BALANCE_JOIN = `LEFT JOIN (
  SELECT invoice_id, SUM(amount) AS paid FROM payments WHERE voided_at IS NULL GROUP BY invoice_id
) p ON p.invoice_id = i.id`;

const toDateOnly = (value: Date | string | null): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toIso = (value: Date | string | null): string => {
  if (value === null || value === undefined) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sales: SalesService,
  ) {}

  async summary(scope: RequestScope = SYSTEM_SCOPE): Promise<DashboardSummary> {
    const [billing, server, online, revenue, customers, receivable, payments, invoices, onu] =
      await Promise.all([
        this.billing(),
        readServerMetrics(),
        this.online(),
        this.sales.revenueSnapshot(scope).catch(() => EMPTY_REVENUE),
        this.customerBreakdown(),
        this.receivable(),
        this.recentPayments(),
        this.recentInvoices(),
        this.onuHealth(),
      ]);

    // Angka kartu "pendapatan hari ini" mengikuti cakupan akun, sama seperti
    // angka di menu Laporan — bukan angka global yang hanya bisa dilihat admin.
    return {
      ...billing,
      today_revenue: revenue.today_revenue,
      today_payments: revenue.today_payments + revenue.today_vouchers,
      revenue,
      customers,
      receivable,
      recent_payments: payments,
      recent_invoices: invoices,
      onu,
      server,
      online,
    };
  }

  /** Pelanggan menurut status: dasar menjawab "berapa yang aktif". */
  private async customerBreakdown(): Promise<CustomerBreakdown> {
    const empty: CustomerBreakdown = { total: 0, active: 0, expired: 0, suspend: 0, disable: 0 };
    try {
      const row = await this.db.queryOne<Record<string, number | string>>(
        `SELECT COUNT(*) AS total,
                SUM(status = 'active') AS active,
                SUM(status = 'expired') AS expired,
                SUM(status = 'suspend') AS suspend,
                SUM(status = 'disable') AS disable
           FROM customers`,
      );
      if (!row) return empty;
      return {
        total: Number(row.total ?? 0),
        active: Number(row.active ?? 0),
        expired: Number(row.expired ?? 0),
        suspend: Number(row.suspend ?? 0),
        disable: Number(row.disable ?? 0),
      };
    } catch (error) {
      this.logger.warn(`Sebaran pelanggan tidak terbaca: ${message(error)}`);
      return empty;
    }
  }

  /**
   * Piutang: berapa yang sudah lewat jatuh tempo dan berapa yang akan jatuh
   * tempo. Sisa tagihan (bukan nominal penuh) yang dijumlahkan, supaya tagihan
   * yang sudah dibayar sebagian tidak terlihat menunggak penuh.
   */
  private async receivable(): Promise<ReceivableSnapshot> {
    const empty: ReceivableSnapshot = {
      overdue_count: 0,
      overdue_total: 0,
      due_soon_count: 0,
      due_soon_total: 0,
      oldest: [],
    };
    try {
      const row = await this.db.queryOne<Record<string, number | string>>(
        `SELECT
           SUM(late > 0) AS overdue_count,
           COALESCE(SUM(IF(late > 0, balance, 0)), 0) AS overdue_total,
           -- late negatif = jatuh tempo masih di depan; 0 = jatuh tempo hari ini.
           SUM(late BETWEEN -7 AND 0) AS due_soon_count,
           COALESCE(SUM(IF(late BETWEEN -7 AND 0, balance, 0)), 0) AS due_soon_total
         FROM (
           SELECT i.due_date, i.amount - COALESCE(p.paid, 0) AS balance,
                  DATEDIFF(CURDATE(), i.due_date) AS late
             FROM invoices i ${BALANCE_JOIN}
            WHERE i.status NOT IN ('paid', 'void')
         ) t`,
      );

      const oldest = await this.db.query<{
        id: number;
        invoice_number: string;
        customer_name: string;
        balance: number | string;
        due_date: Date | string;
        days_late: number | string;
      }>(
        `SELECT i.id, i.invoice_number, i.customer_name,
                i.amount - COALESCE(p.paid, 0) AS balance, i.due_date,
                DATEDIFF(CURDATE(), i.due_date) AS days_late
           FROM invoices i ${BALANCE_JOIN}
          WHERE i.status NOT IN ('paid', 'void') AND i.due_date < CURDATE()
          ORDER BY i.due_date ASC
          LIMIT 5`,
      );

      return {
        overdue_count: Number(row?.overdue_count ?? 0),
        overdue_total: Number(row?.overdue_total ?? 0),
        due_soon_count: Number(row?.due_soon_count ?? 0),
        due_soon_total: Number(row?.due_soon_total ?? 0),
        oldest: oldest.map((item) => ({
          id: item.id,
          invoice_number: String(item.invoice_number),
          customer_name: String(item.customer_name),
          amount: Number(item.balance ?? 0),
          due_date: toDateOnly(item.due_date) ?? '',
          days_late: Number(item.days_late ?? 0),
        })),
      };
    } catch (error) {
      this.logger.warn(`Piutang tidak terbaca: ${message(error)}`);
      return empty;
    }
  }

  /** Lima pembayaran sah terakhir — bukti uang masuk terakhir. */
  private async recentPayments(): Promise<RecentPayment[]> {
    try {
      const rows = await this.db.query<{
        id: number;
        invoice_number: string;
        customer_name: string;
        amount: number | string;
        method: string;
        paid_at: Date | string;
        recorded_by_name: string | null;
      }>(
        `SELECT p.id, i.invoice_number, i.customer_name, p.amount, p.method, p.paid_at,
                u.name AS recorded_by_name
           FROM payments p
           JOIN invoices i ON i.id = p.invoice_id
           LEFT JOIN users u ON u.id = p.recorded_by
          WHERE p.voided_at IS NULL
          ORDER BY p.paid_at DESC, p.id DESC
          LIMIT 5`,
      );
      return rows.map((row) => ({
        id: row.id,
        invoice_number: String(row.invoice_number),
        customer_name: String(row.customer_name),
        amount: Number(row.amount ?? 0),
        method: String(row.method),
        paid_at: toIso(row.paid_at),
        recorded_by_name: row.recorded_by_name,
      }));
    } catch (error) {
      this.logger.warn(`Pembayaran terbaru tidak terbaca: ${message(error)}`);
      return [];
    }
  }

  /** Lima tagihan terakhir (tagihan void tidak ditampilkan). */
  private async recentInvoices(): Promise<RecentInvoice[]> {
    try {
      const rows = await this.db.query<{
        id: number;
        invoice_number: string;
        customer_name: string;
        amount: number | string;
        status: string;
        due_date: Date | string;
      }>(
        `SELECT i.id, i.invoice_number, i.customer_name, i.amount,
                ${STATUS_EXPR} AS status, i.due_date
           FROM invoices i
          WHERE i.status <> 'void'
          ORDER BY i.id DESC
          LIMIT 5`,
      );
      return rows.map((row) => ({
        id: row.id,
        invoice_number: String(row.invoice_number),
        customer_name: String(row.customer_name),
        amount: Number(row.amount ?? 0),
        status: String(row.status),
        due_date: toDateOnly(row.due_date) ?? '',
      }));
    } catch (error) {
      this.logger.warn(`Tagihan terbaru tidak terbaca: ${message(error)}`);
      return [];
    }
  }

  /**
   * Kondisi ONU dari inventori hasil sync OLT terakhir.
   *
   * `missing` = ONU yang tidak terlihat saat sync — petunjuk gangguan, bukan
   * kepastian: bisa saja perangkat pelanggan sedang dimatikan. Angka ini hanya
   * isyarat untuk membuka menu OLT.
   */
  private async onuHealth(): Promise<OnuHealth> {
    try {
      const row = await this.db.queryOne<{ total: number | string; missing: number | string }>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(missing_at IS NOT NULL), 0) AS missing FROM olt_onus`,
      );
      return { total: Number(row?.total ?? 0), missing: Number(row?.missing ?? 0), error: null };
    } catch (error) {
      // Tabel OLT belum ada (migrasi 022/031 belum jalan): bukan kegagalan dashboard.
      return { total: 0, missing: 0, error: message(error) };
    }
  }

  private async billing(): Promise<BillingRow> {
    // Sisa tagihan = amount dikurangi pembayaran yang tidak dibatalkan.
    const rows = await this.db.query<BillingRow>(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM packages WHERE is_active = 1) AS active_packages,
        (SELECT COUNT(*) FROM invoices WHERE status <> 'void') AS total_invoices,
        (SELECT COUNT(*) FROM invoices WHERE status NOT IN ('paid', 'void')) AS unpaid_count,
        (SELECT COALESCE(SUM(i.amount - COALESCE(p.paid, 0)), 0)
           FROM invoices i
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS paid
               FROM payments
              WHERE voided_at IS NULL
              GROUP BY invoice_id
           ) p ON p.invoice_id = i.id
          WHERE i.status NOT IN ('paid', 'void')) AS unpaid_total,
        (SELECT COALESCE(SUM(amount), 0) FROM payments
          WHERE voided_at IS NULL AND DATE(paid_at) = CURDATE()) AS today_revenue,
        (SELECT COUNT(*) FROM payments
          WHERE voided_at IS NULL AND DATE(paid_at) = CURDATE()) AS today_payments
    `);
    return rows[0] ?? EMPTY_BILLING;
  }

  /**
   * Angka online HANYA dari radacct.
   *
   * Tidak ada cadangan lewat API perangkat: dashboard dibuka sepanjang hari
   * dan tidak boleh membuat koneksi ke router. Bila accounting belum menulis
   * apa pun, hasilnya null + pesan — bukan 0 yang terlihat seperti fakta.
   */
  private async online(): Promise<OnlineCounts> {
    const radius = await this.radiusOnline();
    if (radius) return radius;

    return {
      hotspot: null,
      ppp: null,
      hotspot_voucher: null,
      hotspot_member: null,
      unclassified: 0,
      device: 'RADIUS (radacct)',
      error:
        'Accounting RADIUS belum mencatat sesi apa pun. Periksa layanan FreeRADIUS dan ' +
        'pendaftaran NAS — angka online tidak diambil dari perangkat.',
      source: null,
    };
  }

  /**
   * Hitung sesi terbuka dari radacct.
   *
   * Mengembalikan null bila accounting belum pernah menulis apa pun — bukan 0.
   * Bedanya penting: 0 berarti "tidak ada yang online", null berarti "tidak
   * tahu". Tanpa pembedaan itu, dashboard akan berbohong saat accounting mati.
   */
  private async radiusOnline(): Promise<OnlineCounts | null> {
    try {
      // Klasifikasi memakai `radius_vouchers.profile_type` — data kita sendiri.
      // `nasporttype` TIDAK bisa diandalkan: RouterOS mengirim 'Wireless-802.11'
      // untuk klien hotspot, sehingga sesi hotspot terhitung 0.
      // nasporttype hanya dipakai sebagai cadangan bila akunnya tidak ada.
      const row = await this.db.queryOne<{
        total: number;
        hotspot: number;
        ppp: number;
        hotspot_voucher: number;
        hotspot_member: number;
        classified: number;
        last_seen: Date | null;
      }>(
        `SELECT COUNT(*) AS total,
                SUM(kind = 'hotspot') AS hotspot,
                SUM(kind = 'ppp') AS ppp,
                SUM(kind = 'hotspot' AND utype = 'voucher') AS hotspot_voucher,
                SUM(kind = 'hotspot' AND utype = 'member') AS hotspot_member,
                SUM(kind IS NOT NULL) AS classified,
                MAX(a.acctstarttime) AS last_seen
           FROM (
             SELECT a.username,
                    COALESCE(
                      v.profile_type,
                      CASE a.nasporttype
                        WHEN 'Hotspot' THEN 'hotspot'
                        WHEN 'PPP' THEN 'ppp'
                        ELSE NULL
                      END
                    ) AS kind,
                    v.user_type AS utype,
                    a.acctstarttime
               FROM radacct a
               LEFT JOIN radius_vouchers v ON v.username = a.username
              WHERE a.acctstoptime IS NULL
           ) AS a`,
      );
      if (!row) return null;

      const ever = await this.db.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM radacct');
      // Belum ada satu pun baris accounting: jangan laporkan 0 sebagai fakta.
      if (!ever || Number(ever.total) === 0) return null;

      const total = Number(row.total ?? 0);
      const classified = Number(row.classified ?? 0);
      return {
        hotspot: Number(row.hotspot ?? 0),
        ppp: Number(row.ppp ?? 0),
        hotspot_voucher: Number(row.hotspot_voucher ?? 0),
        hotspot_member: Number(row.hotspot_member ?? 0),
        unclassified: Math.max(0, total - classified),
        device: 'RADIUS (radacct)',
        error: null,
        source: 'radius',
      };
    } catch (error) {
      this.logger.warn(`radacct tidak terbaca: ${message(error)}`);
      return null;
    }
  }
}

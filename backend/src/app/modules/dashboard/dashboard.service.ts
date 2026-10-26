import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { readServerMetrics, ServerMetrics } from './system-metrics';

// Ringkasan dashboard: metrik host, hitungan sesi online dari perangkat, dan
// angka tagihan. Semua query di sini baca-saja.

export interface DashboardSummary {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
  server: ServerMetrics;
  online: OnlineCounts;
}

export interface OnlineCounts {
  hotspot: number | null;
  ppp: number | null;
  device: string | null;
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

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mikrotik: MikrotikService,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const [billing, server, online] = await Promise.all([
      this.billing(),
      readServerMetrics(),
      this.online(),
    ]);
    return { ...billing, server, online };
  }

  private async billing(): Promise<BillingRow> {
    // Sisa tagihan = amount dikurangi pembayaran yang tidak dibatalkan.
    const rows = await this.db.query<BillingRow>(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM packages WHERE is_active = 1) AS active_packages,
        (SELECT COUNT(*) FROM invoices) AS total_invoices,
        (SELECT COUNT(*) FROM invoices WHERE status <> 'paid') AS unpaid_count,
        (SELECT COALESCE(SUM(i.amount - COALESCE(p.paid, 0)), 0)
           FROM invoices i
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS paid
               FROM payments
              WHERE voided_at IS NULL
              GROUP BY invoice_id
           ) p ON p.invoice_id = i.id
          WHERE i.status <> 'paid') AS unpaid_total,
        (SELECT COALESCE(SUM(amount), 0) FROM payments
          WHERE voided_at IS NULL AND DATE(paid_at) = CURDATE()) AS today_revenue,
        (SELECT COUNT(*) FROM payments
          WHERE voided_at IS NULL AND DATE(paid_at) = CURDATE()) AS today_payments
    `);
    return rows[0] ?? EMPTY_BILLING;
  }

  // Online dihitung dari daftar active RouterOS pada perangkat default, bukan
  // dari radacct: radacct baru terisi bila accounting aktif, sedangkan daftar
  // active selalu mencerminkan sesi yang benar-benar terhubung.
  private async online(): Promise<OnlineCounts> {
    const devices = await this.mikrotik.listDevices().catch((error) => {
      this.logger.warn(`Daftar perangkat tidak terbaca: ${message(error)}`);
      return null;
    });
    const device =
      devices?.rows.find((row) => row.id === devices.default_device_id) ?? null;
    if (!device) {
      return {
        hotspot: null,
        ppp: null,
        device: null,
        error: 'Belum ada perangkat MikroTik aktif.',
      };
    }

    try {
      const [hotspot, ppp] = await this.mikrotik.runWithDevice(device.id, () =>
        Promise.all([this.mikrotik.hotspotActive(), this.mikrotik.pppActive()]),
      );
      return { hotspot: hotspot.length, ppp: ppp.length, device: device.name, error: null };
    } catch (error) {
      return { hotspot: null, ppp: null, device: device.name, error: message(error) };
    }
  }
}

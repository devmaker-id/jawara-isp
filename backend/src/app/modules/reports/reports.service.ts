import { Injectable } from '@nestjs/common';
import { InvoiceBalance, LedgerSummary, MethodTotal, Payment } from '../payments/payments.repository';
import { PaymentsService } from '../payments/payments.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SalesService } from '../sales/sales.service';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { ReportQueryDto, ReportType } from './dto/report.dto';
import { VoucherUsageReport, VoucherUsageService } from './voucher-usage.service';

export interface ReportResult {
  type: ReportType;
  from: string | null;
  to: string | null;
  method: string | null;
  // Ringkasan selalu berbasis query: pemasukan periode + saldo tagihan saat ini.
  summary: LedgerSummary;
  /**
   * Omzet = nilai invoice yang diterbitkan pada periode (void dikecualikan),
   * dihitung dari tanggal transaksi. Berbeda dari `summary.income` (kas masuk
   * berdasarkan tanggal pembayaran).
   */
  issued: { total: number; count: number; voided: number; voided_count: number };
  /**
   * Pendapatan periode dari dua sumber: tagihan (payments) dan penjualan
   * voucher. `summary.income` tetap khusus pembayaran tagihan agar angka lama
   * tidak berubah arti; total pendapatan ada di `revenue.total_income`.
   */
  revenue: Awaited<ReturnType<SalesService['revenue']>>;
  // Daftar penjualan voucher (type = 'vouchers') atau pembayaran/tagihan.
  voucher_sales: Array<Record<string, unknown>>;
  /** Indikator penggunaan pertama voucher (type = 'voucher-usage'), bukan penjualan. */
  voucher_usage: VoucherUsageReport | null;
  rows: Array<Payment | InvoiceBalance>;
  by_method: MethodTotal[];
  total: number;
  page: number;
  limit: number;
}

// Laporan memakai query PaymentsRepository yang sama dengan halaman Pembayaran.
// Tidak ada perhitungan angka di frontend dan tidak ada ledger kedua.
@Injectable()
export class ReportsService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly invoices: InvoicesService,
    private readonly sales: SalesService,
    private readonly voucherUsage: VoucherUsageService,
  ) {}

  // `scope` berasal dari akun terautentikasi; seluruh angka laporan mengikuti
  // cakupan itu (pemasukan, saldo, metode, daftar, dan total).
  async build(query: ReportQueryDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ReportResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    // Pendapatan dihitung sekali di SalesService dan dipakai semua jenis
    // laporan, supaya angkanya tidak berbeda antar halaman.
    const [summary, revenue, issued] = await Promise.all([
      this.payments.summary(query.from, query.to, scope),
      this.sales.revenue(query.from, query.to, scope),
      this.invoices.issued(query.from, query.to, scope),
    ]);
    const base = {
      type: query.type,
      from: query.from ?? null,
      to: query.to ?? null,
      method: query.method ?? null,
      summary,
      issued,
      revenue,
      voucher_sales: [] as Array<Record<string, unknown>>,
      voucher_usage: null as VoucherUsageReport | null,
      page,
      limit,
    };

    switch (query.type) {
      case 'summary':
        return { ...base, rows: [], by_method: [], total: 0 };

      case 'by-method':
        return {
          ...base,
          rows: [],
          by_method: await this.payments.methodTotals(query.from, query.to, scope),
          total: 0,
        };

      case 'vouchers': {
        const result = await this.sales.listSales(
          { from: query.from, to: query.to, page, limit },
          scope,
        );
        return {
          ...base,
          rows: [],
          by_method: [],
          voucher_sales: result.rows as unknown as Array<Record<string, unknown>>,
          total: result.total,
        };
      }

      case 'voucher-usage': {
        // Indikator penggunaan (MIN(authdate) Accept), bukan penjualan.
        const usage = await this.voucherUsage.summary(query.from, query.to, scope);
        return {
          ...base,
          rows: [],
          by_method: [],
          voucher_usage: usage,
          total: usage.rows.length,
        };
      }

      case 'unpaid': {
        const result = await this.payments.payableInvoices({ page, limit }, scope);
        return { ...base, rows: result.rows, by_method: [], total: result.total };
      }

      default: {
        const result = await this.payments.list(
          {
            from: query.from,
            to: query.to,
            method: query.method,
            status: 'all',
            page,
            limit,
          },
          scope,
        );
        return { ...base, rows: result.rows, by_method: [], total: result.total };
      }
    }
  }
}

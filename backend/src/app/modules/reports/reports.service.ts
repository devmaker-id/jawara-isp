import { Injectable } from '@nestjs/common';
import { InvoiceBalance, LedgerSummary, MethodTotal, Payment } from '../payments/payments.repository';
import { PaymentsService } from '../payments/payments.service';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { ReportQueryDto, ReportType } from './dto/report.dto';

export interface ReportResult {
  type: ReportType;
  from: string | null;
  to: string | null;
  method: string | null;
  // Ringkasan selalu berbasis query: pemasukan periode + saldo tagihan saat ini.
  summary: LedgerSummary;
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
  constructor(private readonly payments: PaymentsService) {}

  // `scope` berasal dari akun terautentikasi; seluruh angka laporan mengikuti
  // cakupan itu (pemasukan, saldo, metode, daftar, dan total).
  async build(query: ReportQueryDto, scope: RequestScope = SYSTEM_SCOPE): Promise<ReportResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const summary = await this.payments.summary(query.from, query.to, scope);
    const base = {
      type: query.type,
      from: query.from ?? null,
      to: query.to ?? null,
      method: query.method ?? null,
      summary,
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

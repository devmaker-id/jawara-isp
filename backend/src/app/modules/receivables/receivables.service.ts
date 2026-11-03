import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RequestScope } from '../auth/request-scope';
import { ReceivableQueryDto, SetCreditLimitDto } from './dto/receivable.dto';
import {
  ReceivableBalance,
  ReceivableReportQuery,
  ReceivablesRepository,
} from './receivables.repository';

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Piutang pelanggan.
 *
 * Tidak ada tabel piutang: saldo dihitung dari sisa tagihan (invoices) yang
 * belum lunas dan belum void, dikurangi pembayaran sah. Yang bisa diubah
 * hanyalah batas kredit per pelanggan.
 */
@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: ReceivablesRepository,
  ) {}

  async balance(customerId: number, scope: RequestScope): Promise<
    ReceivableBalance & {
      customer: { id: number; name: string; internet_no: string | null };
      invoices: Awaited<ReturnType<ReceivablesRepository['invoicesOf']>>;
    }
  > {
    const customer = await this.repository.customerInScope(customerId, scope);
    if (!customer) throw new NotFoundException('Pelanggan tidak ditemukan dalam cakupan Anda.');

    const { outstanding, limit, invoices } = await this.repository.balance(customerId);
    const overdue = invoices
      .filter((invoice) => invoice.days_late > 0)
      .reduce((sum, invoice) => sum + invoice.balance, 0);
    const notDue = invoices
      .filter((invoice) => invoice.days_late <= 0)
      .reduce((sum, invoice) => sum + invoice.balance, 0);

    return {
      customer: { id: customer.id, name: customer.name, internet_no: customer.internet_no },
      outstanding,
      limit,
      remaining: round2(Math.max(limit - outstanding, 0)),
      open_invoices: invoices.length,
      overdue: round2(overdue),
      not_due: round2(notDue),
      invoices,
    };
  }

  /** Hanya admin (dijaga juga oleh Roles guard di controller). */
  async setLimit(
    customerId: number,
    dto: SetCreditLimitDto,
    actor: { id: number; ip: string },
  ): Promise<{ limit: number; previous: number }> {
    const rows = await this.db.query<{ credit_limit: number | string }>(
      'SELECT credit_limit FROM customers WHERE id = ?',
      [customerId],
    );
    if (rows.length === 0) throw new NotFoundException('Pelanggan tidak ditemukan.');

    const previous = Number(rows[0].credit_limit ?? 0);
    const limit = round2(Number(dto.limit));
    await this.repository.setCreditLimit(customerId, limit);

    await this.db
      .execute('INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)', [
        actor.id,
        'customer.credit_limit',
        JSON.stringify({ customer_id: customerId, before: previous, after: limit }),
        actor.ip,
      ])
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit credit_limit gagal: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return { limit, previous };
  }

  report(query: ReceivableQueryDto, scope: RequestScope) {
    const normalized: ReceivableReportQuery = {
      from: query.from,
      to: query.to,
      due_from: query.due_from,
      due_to: query.due_to,
      search: query.search?.trim() || undefined,
      owner_id: query.owner_id,
      profile_type: query.profile_type,
      status: query.status,
      page: query.page,
      limit: query.limit,
    };
    return this.repository.report(normalized, scope);
  }

  summary(scope: RequestScope) {
    return this.repository.summary(scope);
  }
}
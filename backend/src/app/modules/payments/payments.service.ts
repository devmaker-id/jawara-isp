import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CreatePaymentBodyDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PayableInvoicesQueryDto,
  VoidPaymentDto,
} from './dto/payment.dto';
import {
  InvoiceBalance,
  LedgerSummary,
  MethodTotal,
  Payment,
  PaymentActor,
  PaymentError,
  PaymentPage,
  PaymentResult,
  PaymentsRepository,
} from './payments.repository';
import { isMissingOwnerColumn, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';

export const DEFAULT_PAGE_SIZE = 20;

const DB_UNAVAILABLE = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ENOTFOUND',
];

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

function rupiah(value: number): string {
  return `Rp ${value.toLocaleString('id-ID')}`;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly repository: PaymentsRepository) {}

  private rethrow(error: unknown): never {
    if (isMissingOwnerColumn(error)) {
      throw new ServiceUnavailableException(
        'Data pembayaran reseller belum dapat difilter: kolom customers.owner_id belum ada ' +
          '(migrasi 003_customer_reseller_ownership.sql belum dijalankan).',
      );
    }
    if (error instanceof PaymentError) {
      switch (error.code) {
        case 'INVOICE_NOT_FOUND':
        case 'PAYMENT_NOT_FOUND':
          throw new NotFoundException(error.message);
        case 'ALREADY_PAID':
          throw new ConflictException('Tagihan sudah lunas, tidak ada sisa yang bisa dibayar');
        case 'OVERPAY':
          throw new BadRequestException(
            `Nominal pembayaran melebihi sisa tagihan (sisa ${rupiah(error.remaining ?? 0)})`,
          );
        case 'IDEMPOTENT_VOIDED':
          throw new ConflictException(error.message);
        case 'ALREADY_VOIDED':
          throw new ConflictException('Pembayaran sudah dibatalkan sebelumnya');
        case 'VOID_REASON_REQUIRED':
          throw new BadRequestException('Alasan void wajib diisi');
      }
    }

    const code = errorCode(error);
    if (code === 'ER_NO_SUCH_TABLE') {
      throw new ServiceUnavailableException(
        'Tabel payments belum ada di database. Migrasi 001_payments.sql belum dijalankan, ' +
          'jadi pencatatan pembayaran belum bisa dipakai.',
      );
    }
    if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_NO_REFERENCED_ROW') {
      throw new NotFoundException('Tagihan atau user tidak ditemukan');
    }
    if (code === 'ER_NO_DEFAULT_FOR_FIELD') {
      throw new BadRequestException('Data pembayaran tidak lengkap');
    }
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  async listByInvoice(invoiceId: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Payment[]> {
    return this.repository.listByInvoice(invoiceId, scope).catch((error) => this.rethrow(error));
  }

  async list(
    query: ListPaymentsQueryDto,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<PaymentPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    return this.repository
      .search(
        {
          search: query.search?.trim() || undefined,
          from: query.from,
          to: query.to,
          method: query.method,
          status: query.status ?? 'all',
        },
        page,
        limit,
        scope,
      )
      .catch((error) => this.rethrow(error));
  }

  // Ringkasan halaman Pembayaran: pemasukan periode + saldo tagihan saat ini.
  // Dua hal berbeda dan sengaja dipisah agar tidak tertukar.
  async summary(
    from?: string,
    to?: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<LedgerSummary> {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && !dateOnly.test(from)) || (to && !dateOnly.test(to))) {
      throw new BadRequestException('Tanggal harus format YYYY-MM-DD');
    }
    const [income, balance] = await Promise.all([
      this.repository.incomeOf(from, to, scope),
      this.repository.outstanding(scope),
    ]).catch((error) => this.rethrow(error));

    return {
      income: income.income,
      transactions: income.transactions,
      outstanding: balance.outstanding,
      overdue: balance.overdue,
    };
  }

  async methodTotals(
    from?: string,
    to?: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<MethodTotal[]> {
    return this.repository.methodTotals(from, to, scope).catch((error) => this.rethrow(error));
  }

  async payableInvoices(
    query: PayableInvoicesQueryDto,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{
    rows: InvoiceBalance[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.repository
      .payableInvoices(query.search?.trim() || undefined, page, limit, scope)
      .catch((error) => this.rethrow(error));
    return { ...result, page, limit };
  }

  // Mencatat pembayaran dengan invoice di body (halaman Pembayaran). Aturan,
  // transaksi, dan idempotensi sama persis dengan endpoint per-invoice.
  async createFromBody(dto: CreatePaymentBodyDto, actor: PaymentActor): Promise<PaymentResult> {
    const { invoice_id: invoiceId, ...payment } = dto;
    return this.create(invoiceId, payment, actor);
  }

  async create(
    invoiceId: number,
    dto: CreatePaymentDto,
    actor: PaymentActor,
  ): Promise<PaymentResult> {
    if (dto.paid_at && dto.paid_at > todayIso()) {
      throw new BadRequestException('Tanggal pembayaran tidak boleh melebihi hari ini');
    }
    return this.repository
      .create(invoiceId, dto, actor)
      .catch((error) => this.rethrow(error));
  }

  async void(id: number, dto: VoidPaymentDto, actor: PaymentActor): Promise<PaymentResult> {
    const reason = (dto.reason ?? '').trim();
    if (reason.length === 0) {
      throw new BadRequestException('Alasan void wajib diisi');
    }
    return this.repository.void(id, reason, actor).catch((error) => this.rethrow(error));
  }
}

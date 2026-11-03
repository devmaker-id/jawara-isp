import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolConnection } from 'mysql2/promise';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { isMissingOwnerColumn, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { FinanceEvent, FinanceEventsRepository } from '../finance/finance-events.repository';
import {
  Invoice,
  InvoiceActor,
  InvoiceError,
  InvoiceQuery,
  InvoiceSummary,
  InvoicesRepository,
} from './invoices.repository';

export type { Invoice };

const DB_UNAVAILABLE = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_NO_SUCH_TABLE',
  'ENOTFOUND',
];

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly repository: InvoicesRepository,
    private readonly financeEvents: FinanceEventsRepository,
  ) {}

  private rethrow(error: unknown): never {
    if (isMissingOwnerColumn(error)) {
      throw new ServiceUnavailableException(
        'Data tagihan reseller belum dapat difilter: kolom customers.owner_id belum ada ' +
          '(migrasi 003_customer_reseller_ownership.sql belum dijalankan).',
      );
    }
    if (error instanceof InvoiceError) {
      switch (error.code) {
        case 'NOT_FOUND':
        case 'CUSTOMER_NOT_FOUND':
          throw new NotFoundException(error.message);
        case 'PAID_INVOICE_LOCKED':
        case 'INVOICE_ALREADY_VOID':
        case 'INVOICE_HAS_PAYMENTS':
        case 'DELETE_FORBIDDEN':
          throw new ConflictException(error.message);
        case 'INVALID_PERIOD':
          throw new BadRequestException(error.message);
        case 'INVALID_STATUS':
          throw new BadRequestException(
            'Status lunas/parsial hanya dapat diatur melalui endpoint pembayaran',
          );
      }
    }

    const code = errorCode(error);
    if (code === 'ER_DUP_ENTRY') {
      // UNIQUE(customer_id, username, period_start) dari migrasi 032: satu
      // kewajiban tagihan per layanan & periode.
      const message = (error as { message?: string })?.message ?? '';
      if (message.includes('uq_invoices_period')) {
        throw new ConflictException(
          'Tagihan untuk akun dan periode ini sudah ada. Periksa daftar tagihan, ' +
            'atau batalkan (void) tagihan lama bila memang diganti.',
        );
      }
      throw new ConflictException('Nomor tagihan bentrok, ulangi penyimpanan');
    }
    if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_NO_REFERENCED_ROW') {
      throw new NotFoundException('Pelanggan tidak ditemukan');
    }
    // FK payments.invoice_id ON DELETE RESTRICT: tagihan yang punya riwayat
    // pembayaran (termasuk yang sudah di-void) tidak boleh dihapus.
    if (code === 'ER_ROW_IS_REFERENCED_2') {
      throw new ConflictException(
        'Tagihan punya riwayat pembayaran sehingga tidak dapat dihapus. ' +
          'Void pembayarannya lebih dulu bila memang salah catat.',
      );
    }
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  findAll(scope: RequestScope = SYSTEM_SCOPE): Promise<Invoice[]> {
    return this.repository.findAll(scope).catch((error) => this.rethrow(error));
  }

  // Tanpa `page` → array (kompatibel). Dengan `page` → { rows, total, page, limit }.
  async list(
    query: InvoiceQuery,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<Invoice[] | { rows: Invoice[]; total: number; page: number; limit: number }> {
    if (query.page === undefined) {
      const rows = await this.repository.findAll(scope).catch((error) => this.rethrow(error));
      const needle = query.search?.trim().toLowerCase();
      return rows.filter((invoice) => {
        if (query.status && invoice.status !== query.status) return false;
        if (!needle) return true;
        return `${invoice.invoice_number} ${invoice.customer_name}`.toLowerCase().includes(needle);
      });
    }

    // Batas 1000 mengikuti pilihan "tampilkan" di panel (25/50/100/500/1000).
    const limit = Math.max(1, Math.min(1000, query.limit ?? 25));
    const page = Math.max(1, query.page);
    const { rows, total } = await this.repository
      .findPage({ ...query, page, limit }, scope)
      .catch((error) => this.rethrow(error));
    return { rows, total, page, limit };
  }

  async findOne(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Invoice> {
    const invoice = await this.repository
      .findById(id, scope)
      .catch((error) => this.rethrow(error));
    if (!invoice) {
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return invoice;
  }

  findByCustomer(customerId: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Invoice[]> {
    return this.repository.findByCustomer(customerId, scope).catch((error) => this.rethrow(error));
  }

  getSummary(scope: RequestScope = SYSTEM_SCOPE): Promise<InvoiceSummary> {
    return this.repository.summary(scope).catch((error) => this.rethrow(error));
  }

  // `conn` dipakai pemanggil yang sudah memegang transaksi (perpanjangan
  // dengan piutang: cek limit + tagihan harus satu langkah atomik).
  create(dto: CreateInvoiceDto, actor: InvoiceActor, conn?: PoolConnection): Promise<Invoice> {
    return this.repository.create(dto, actor, conn).catch((error) => this.rethrow(error));
  }

  update(id: number, dto: UpdateInvoiceDto, actor: InvoiceActor): Promise<Invoice> {
    return this.repository.update(id, dto, actor).catch((error) => this.rethrow(error));
  }

  void(id: number, reason: string, actor: InvoiceActor): Promise<Invoice> {
    return this.repository.void(id, reason, actor).catch((error) => this.rethrow(error));
  }

  // DELETE fisik tidak lagi tersedia; selalu ditolak dengan alasan yang jelas.
  async remove(): Promise<{ ok: true }> {
    return this.repository.remove().catch((error) => this.rethrow(error));
  }

  // Riwayat keuangan satu tagihan. Cakupan reseller diperiksa lewat findOne
  // (tagihan di luar haknya = 404), bukan lewat filter tabel event.
  async events(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<FinanceEvent[]> {
    await this.findOne(id, scope);
    return this.financeEvents.list('invoice', id);
  }
}
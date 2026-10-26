import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { isMissingOwnerColumn, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import {
  Invoice,
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
  constructor(private readonly repository: InvoicesRepository) {}

  private rethrow(error: unknown): never {
    if (isMissingOwnerColumn(error)) {
      throw new ServiceUnavailableException(
        'Data tagihan reseller belum dapat difilter: kolom customers.reseller_id belum ada ' +
          '(migrasi 003_customer_reseller_ownership.sql belum dijalankan).',
      );
    }
    if (error instanceof InvoiceError) {
      switch (error.code) {
        case 'NOT_FOUND':
        case 'CUSTOMER_NOT_FOUND':
          throw new NotFoundException(error.message);
        case 'PAID_INVOICE_LOCKED':
          throw new ConflictException(
            'Tagihan sudah lunas: nominal dan jatuh tempo tidak dapat diubah',
          );
        case 'INVALID_STATUS':
          throw new BadRequestException(
            'Status lunas/parsial hanya dapat diatur melalui endpoint pembayaran',
          );
      }
    }

    const code = errorCode(error);
    if (code === 'ER_DUP_ENTRY') {
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

    const limit = Math.max(1, Math.min(200, query.limit ?? 20));
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

  create(dto: CreateInvoiceDto): Promise<Invoice> {
    return this.repository.create(dto).catch((error) => this.rethrow(error));
  }

  update(id: number, dto: UpdateInvoiceDto): Promise<Invoice> {
    return this.repository.update(id, dto).catch((error) => this.rethrow(error));
  }

  async remove(id: number): Promise<{ ok: true }> {
    const deleted = await this.repository.remove(id).catch((error) => this.rethrow(error));
    if (!deleted) {
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}
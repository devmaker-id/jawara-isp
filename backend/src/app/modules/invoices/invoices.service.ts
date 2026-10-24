import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CreateInvoiceDto, PayInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { Invoice, InvoiceError, InvoiceSummary, InvoicesRepository } from './invoices.repository';

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
export class InvoicesService {
  constructor(private readonly repository: InvoicesRepository) {}

  private rethrow(error: unknown): never {
    if (error instanceof InvoiceError) {
      switch (error.code) {
        case 'NOT_FOUND':
        case 'CUSTOMER_NOT_FOUND':
          throw new NotFoundException(error.message);
        case 'ALREADY_PAID':
          throw new ConflictException('Tagihan sudah lunas');
        case 'PAID_INVOICE_LOCKED':
          throw new ConflictException(
            'Tagihan sudah lunas: nominal dan jatuh tempo tidak dapat diubah',
          );
        case 'INVALID_STATUS':
          throw new BadRequestException(
            'Status lunas hanya dapat diatur melalui endpoint pembayaran',
          );
        case 'OVERPAY':
          throw new BadRequestException(
            `Nominal pembayaran melebihi sisa tagihan (sisa ${rupiah(error.remaining ?? 0)})`,
          );
        case 'PARTIAL_UNSUPPORTED':
          throw new ConflictException(
            'Pembayaran parsial belum dapat dicatat karena skema database belum memiliki ' +
              'tabel payments atau kolom nominal terbayar. ' +
              `Sisa tagihan ${rupiah(error.remaining ?? 0)}. Catat pembayaran penuh, ` +
              'atau setujui penambahan tabel payments lebih dulu.',
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
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  findAll(): Promise<Invoice[]> {
    return this.repository.findAll().catch((error) => this.rethrow(error));
  }

  async findOne(id: number): Promise<Invoice> {
    const invoice = await this.repository.findById(id).catch((error) => this.rethrow(error));
    if (!invoice) {
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return invoice;
  }

  findByCustomer(customerId: number): Promise<Invoice[]> {
    return this.repository.findByCustomer(customerId).catch((error) => this.rethrow(error));
  }

  getSummary(): Promise<InvoiceSummary> {
    return this.repository.summary().catch((error) => this.rethrow(error));
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

  async pay(id: number, dto: PayInvoiceDto): Promise<Invoice> {
    // Tanggal pembayaran tidak boleh di masa depan (kolom DATE, tanpa jam).
    if (dto.paid_date && dto.paid_date > todayIso()) {
      throw new BadRequestException('Tanggal pembayaran tidak boleh melebihi hari ini');
    }
    return this.repository.pay(id, dto).catch((error) => this.rethrow(error));
  }
}
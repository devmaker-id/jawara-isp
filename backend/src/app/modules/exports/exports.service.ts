import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { isMissingOwnerColumn, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { EXPORT_ROW_LIMIT, ExportsRepository } from './exports.repository';

export type ExportType = 'customers' | 'invoices' | 'payments';

export const EXPORT_TYPES: ExportType[] = ['customers', 'invoices', 'payments'];

interface ColumnSpec {
  header: string;
  key: string;
}

const SPECS: Record<ExportType, ColumnSpec[]> = {
  customers: [
    { header: 'id', key: 'id' },
    { header: 'nama', key: 'name' },
    { header: 'email', key: 'email' },
    { header: 'telepon', key: 'phone' },
    { header: 'alamat', key: 'address' },
    { header: 'aktif', key: 'is_active' },
    { header: 'dibuat', key: 'created_at' },
  ],
  invoices: [
    { header: 'id', key: 'id' },
    { header: 'nomor_tagihan', key: 'invoice_number' },
    { header: 'customer_id', key: 'customer_id' },
    { header: 'nama_pelanggan', key: 'customer_name' },
    { header: 'nominal', key: 'amount' },
    { header: 'status', key: 'status' },
    { header: 'jatuh_tempo', key: 'due_date' },
    { header: 'tanggal_lunas', key: 'paid_date' },
    { header: 'keterangan', key: 'description' },
    { header: 'dibuat', key: 'created_at' },
  ],
  payments: [
    { header: 'id', key: 'id' },
    { header: 'invoice_id', key: 'invoice_id' },
    { header: 'nomor_tagihan', key: 'invoice_number' },
    { header: 'nama_pelanggan', key: 'customer_name' },
    { header: 'nominal', key: 'amount' },
    { header: 'metode', key: 'method' },
    { header: 'referensi', key: 'reference' },
    { header: 'catatan', key: 'note' },
    { header: 'dibayar_pada', key: 'paid_at' },
    { header: 'void_pada', key: 'voided_at' },
    { header: 'alasan_void', key: 'void_reason' },
    { header: 'dibuat', key: 'created_at' },
  ],
};

// Escape RFC 4180: kutip ganda digandakan, pembungkus dipakai bila ada
// pemisah/kutip/baris baru.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString().slice(0, 19).replace('T', ' ');
  } else if (typeof value === 'number') {
    text = String(value);
  } else if (typeof value === 'boolean') {
    text = value ? '1' : '0';
  } else {
    text = String(value);
  }
  if (/[",\n\r;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: Record<string, unknown>[], type: ExportType): string {
  const spec = SPECS[type];
  const lines = [spec.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(spec.map((column) => csvCell(row[column.key])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

@Injectable()
export class ExportsService {
  constructor(private readonly repository: ExportsRepository) {}

  // Cakupan mengikuti scope akun terautentikasi; reseller hanya menerima
  // barisnya sendiri, dan kolom yang tidak relevan tidak pernah ikut.
  async build(
    type: ExportType,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ filename: string; csv: string; rows: number }> {
    let rows: Record<string, unknown>[];
    try {
      if (type === 'customers') rows = await this.repository.customers(scope);
      else if (type === 'invoices') rows = await this.repository.invoices(scope);
      else rows = await this.repository.payments(scope);
    } catch (error) {
      if (isMissingOwnerColumn(error)) {
        throw new ServiceUnavailableException(
          'Ekspor untuk reseller belum dapat difilter: kolom customers.reseller_id belum ada ' +
            '(migrasi 003_customer_reseller_ownership.sql belum dijalankan).',
        );
      }
      const code = (error as { code?: string })?.code;
      if (code === 'ER_NO_SUCH_TABLE') {
        throw new ServiceUnavailableException(
          'Tabel payments belum ada: 001_payments.sql belum dijalankan, ekspor pembayaran belum tersedia.',
        );
      }
      throw error;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `${type}-${stamp}.csv`,
      csv: toCsv(rows, type),
      rows: rows.length,
    };
  }

  assertType(value: string): ExportType {
    if (!EXPORT_TYPES.includes(value as ExportType)) {
      throw new NotFoundException(
        `Jenis ekspor "${value}" tidak dikenal. Pilihan: ${EXPORT_TYPES.join(', ')}`,
      );
    }
    return value as ExportType;
  }

  get rowLimit(): number {
    return EXPORT_ROW_LIMIT;
  }
}
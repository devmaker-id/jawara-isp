import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { ownerFilter, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';

// Batas baris ekspor: cukup untuk kebutuhan operasional, tetap terlindungi dari
// ekspor tak terbatas. Nilai ini dilaporkan ke pengguna pada header respons.
export const EXPORT_ROW_LIMIT = 5000;

@Injectable()
export class ExportsRepository {
  constructor(private readonly db: DatabaseService) {}

  async customers(scope: RequestScope = SYSTEM_SCOPE): Promise<Record<string, unknown>[]> {
    const owner = ownerFilter(scope, 'customers');
    const where = owner.sql ? ` WHERE ${owner.sql}` : '';
    return this.db.query<RowDataPacket & Record<string, unknown>>(
      `SELECT id, name, email, phone, address, is_active, created_at
         FROM customers${where} ORDER BY id ASC LIMIT ?`,
      [...owner.params, EXPORT_ROW_LIMIT],
    );
  }

  async invoices(scope: RequestScope = SYSTEM_SCOPE): Promise<Record<string, unknown>[]> {
    const owner = ownerFilter(scope, 'invoices');
    const where = owner.sql ? ` WHERE ${owner.sql}` : '';
    // Status memakai kolom tersimpan agar sama dengan filter daftar.
    return this.db.query<RowDataPacket & Record<string, unknown>>(
      `SELECT id, invoice_number, customer_id, customer_name, amount, status,
              due_date, paid_date, description, created_at
         FROM invoices${where} ORDER BY id ASC LIMIT ?`,
      [...owner.params, EXPORT_ROW_LIMIT],
    );
  }

  async payments(scope: RequestScope = SYSTEM_SCOPE): Promise<Record<string, unknown>[]> {
    const owner = ownerFilter(scope, 'payments');
    const where = owner.sql ? ` WHERE ${owner.sql}` : '';
    return this.db.query<RowDataPacket & Record<string, unknown>>(
      `SELECT p.id, p.invoice_id, i.invoice_number, i.customer_name, p.amount, p.method,
              p.reference, p.note, p.paid_at, p.voided_at, p.void_reason, p.created_at
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id${where}
        ORDER BY p.paid_at DESC, p.id DESC LIMIT ?`,
      [...owner.params, EXPORT_ROW_LIMIT],
    );
  }
}
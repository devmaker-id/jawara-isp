import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { ownerFilter, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  created_at: Date;
}

interface CustomerRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: number | boolean;
  created_at: Date;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    // MySQL BOOLEAN = TINYINT(1) → 1/0
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: row.created_at,
  };
}

const COLUMNS = 'id, name, email, phone, address, is_active, created_at';

// Filter daftar pelanggan. `page`/`limit` opsional agar pemanggil lama tetap
// menerima array biasa.
export interface CustomerQuery {
  search?: string;
  status?: 'active' | 'inactive';
  page?: number;
  limit?: number;
}

export interface CustomerRelations {
  invoices: number;
  services: number;
}

// Dilempar saat kolom customers.reseller_id belum ada (migrasi 003 belum
// dijalankan). Service menerjemahkannya menjadi 503 yang jujur, bukan sukses
// palsu.
export class OwnerColumnMissingError extends Error {
  constructor() {
    super('Kolom customers.reseller_id belum tersedia');
    this.name = 'OwnerColumnMissingError';
  }
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(scope: RequestScope = SYSTEM_SCOPE): Promise<Customer[]> {
    const owner = ownerFilter(scope, 'customers');
    const where = owner.sql ? ` WHERE ${owner.sql}` : '';
    const rows = await this.db.query<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers${where} ORDER BY id DESC`,
      owner.params,
    );
    return rows.map(toCustomer);
  }

  // Daftar dengan pencarian/pagination. Nilai selalu di-bind sebagai parameter.
  async findPage(
    query: CustomerQuery,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<{ rows: Customer[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const search = query.search?.trim();

    // Scope wajib ikut pada SELECT dan COUNT (klausa yang sama).
    const owner = ownerFilter(scope, 'customers');
    if (owner.sql) {
      where.push(owner.sql);
      params.push(...owner.params);
    }

    if (search) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (query.status) {
      where.push('is_active = ?');
      params.push(query.status === 'active' ? 1 : 0);
    }

    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const totalRow = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM customers${clause}`,
      params,
    );

    const listParams = [...params];
    let sql = `SELECT ${COLUMNS} FROM customers${clause} ORDER BY id DESC`;
    if (query.limit !== undefined) {
      const limit = Math.max(1, Math.min(200, Math.trunc(query.limit)));
      const page = Math.max(1, Math.trunc(query.page ?? 1));
      sql += ' LIMIT ? OFFSET ?';
      listParams.push(limit, (page - 1) * limit);
    }

    const rows = await this.db.query<CustomerRow>(sql, listParams);
    return {
      rows: rows.map(toCustomer),
      total: totalRow ? Number(totalRow.total) : 0,
    };
  }

  // Apakah kolom kepemilikan reseller sudah ada di database ini?
  async hasOwnerColumn(): Promise<boolean> {
    const row = await this.db.queryOne<{ hit: number }>(
      `SELECT 1 AS hit FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'reseller_id'
        LIMIT 1`,
    );
    return row !== null;
  }

  // Relasi penting yang membuat penghapusan pelanggan berbahaya.
  // payments tidak dihitung karena FK-nya RESTRICT ke invoices (sudah tercakup).
  async countRelations(id: number): Promise<CustomerRelations> {
    const invoices = await this.db.queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = ?',
      [id],
    );
    const services = await this.db.queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM service_sessions WHERE customer_id = ?',
      [id],
    );
    return {
      invoices: invoices ? Number(invoices.total) : 0,
      services: services ? Number(services.total) : 0,
    };
  }

  // Menetapkan/melepas pemilik pelanggan + menulis audit dalam satu transaksi.
  // Hanya dipanggil setelah hasOwnerColumn() bernilai true.
  async assignOwner(
    customerId: number,
    newOwnerId: number | null,
    actor: { userId: number; ip: string },
  ): Promise<{ previousOwnerId: number | null }> {
    return this.db.withTransaction(async (conn) => {
      const [current] = await conn.query<RowDataPacket[]>(
        'SELECT reseller_id FROM customers WHERE id = ? FOR UPDATE',
        [customerId],
      );
      if (current.length === 0) {
        const missing = new Error('Pelanggan tidak ditemukan');
        (missing as { code?: string }).code = 'CUSTOMER_NOT_FOUND';
        throw missing;
      }
      const previousOwnerId =
        current[0].reseller_id === null || current[0].reseller_id === undefined
          ? null
          : Number(current[0].reseller_id);

      await conn.query('UPDATE customers SET reseller_id = ? WHERE id = ?', [
        newOwnerId,
        customerId,
      ]);

      // Struktur audit_logs yang ada: user_id, action, details (text), ip_address.
      await conn.query(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [
          actor.userId,
          'CUSTOMER_OWNER_ASSIGNED',
          JSON.stringify({
            customer_id: customerId,
            previous_owner_id: previousOwnerId,
            new_owner_id: newOwnerId,
            actor_id: actor.userId,
            at: new Date().toISOString(),
          }),
          actor.ip,
        ],
      );

      return { previousOwnerId };
    });
  }

  // Dengan scope reseller, pelanggan milik reseller lain (dan pelanggan tanpa
  // pemilik) tidak ditemukan → service membalas 404 generik.
  async findById(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Customer | null> {
    const owner = ownerFilter(scope, 'customers');
    const clause = owner.sql ? ` AND ${owner.sql}` : '';
    const row = await this.db.queryOne<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers WHERE id = ?${clause}`,
      [id, ...owner.params],
    );
    return row ? toCustomer(row) : null;
  }

  async findByEmail(email: string): Promise<Customer | null> {
    const row = await this.db.queryOne<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers WHERE email = ?`,
      [email],
    );
    return row ? toCustomer(row) : null;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const result = await this.db.execute(
      'INSERT INTO customers (name, email, phone, address, is_active) VALUES (?, ?, ?, ?, ?)',
      [
        dto.name,
        dto.email,
        dto.phone,
        dto.address ?? '',
        dto.is_active === false ? 0 : 1,
      ],
    );
    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error('Gagal membaca data pelanggan setelah disimpan');
    }
    return created;
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer | null> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (dto.name !== undefined) {
      fields.push('name = ?');
      params.push(dto.name);
    }
    if (dto.email !== undefined) {
      fields.push('email = ?');
      params.push(dto.email);
    }
    if (dto.phone !== undefined) {
      fields.push('phone = ?');
      params.push(dto.phone);
    }
    if (dto.address !== undefined) {
      fields.push('address = ?');
      params.push(dto.address);
    }
    if (dto.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(dto.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    const result = await this.db.execute(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = ?`,
      params,
    );
    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.db.execute('DELETE FROM customers WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

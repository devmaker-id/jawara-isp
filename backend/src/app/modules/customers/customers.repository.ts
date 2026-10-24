import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
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

@Injectable()
export class CustomersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Customer[]> {
    const rows = await this.db.query<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers ORDER BY id DESC`,
    );
    return rows.map(toCustomer);
  }

  async findById(id: number): Promise<Customer | null> {
    const row = await this.db.queryOne<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers WHERE id = ?`,
      [id],
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

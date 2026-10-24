import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Role, RoleValues } from '../../config/config.service';

// Bentuk baris tabel `users` di MySQL. `is_active` disimpan TINYINT(1).
export interface UserRecord {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Data yang boleh dibuat/diubah lewat repository. `password_hash` selalu
// sudah ter-hash sebelum sampai di sini — repository tidak pernah menerima
// password mentah.
export interface CreateUserRecord {
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  phone?: string | null;
  address?: string | null;
  is_active?: boolean;
}

export type UpdateUserRecord = Partial<CreateUserRecord>;

interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  phone: string | null;
  address: string | null;
  is_active: number | boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, name, email, password_hash, role, phone, address, is_active, created_at, updated_at';

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password_hash: row.password_hash,
    role: row.role as Role,
    phone: row.phone,
    address: row.address,
    // MySQL BOOLEAN = TINYINT(1) → 1/0
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Satu-satunya jalur baca/tulis tabel `users`. Belum dipakai AuthService
// maupun AdminService pada tahap ini; integrasi dilakukan terpisah agar
// perilaku runtime tidak berubah.
@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<UserRecord[]> {
    const rows = await this.db.query<UserRow>(`SELECT ${COLUMNS} FROM users ORDER BY id ASC`);
    return rows.map(toRecord);
  }

  // Dipakai autentikasi untuk membedakan "akun belum dikonfigurasi" (tabel
  // kosong) dari "kredensial salah" — dua kondisi yang butuh respons berbeda.
  async countAll(): Promise<number> {
    const row = await this.db.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM users');
    return row ? Number(row.total) : 0;
  }

  async countAdmins(): Promise<number> {
    const row = await this.db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1",
    );
    return row ? Number(row.total) : 0;
  }

  async findById(id: number): Promise<UserRecord | null> {
    const row = await this.db.queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
    return row ? toRecord(row) : null;
  }

  // Login memakai email; pencarian dinormalisasi agar kapitalisasi/spasi tidak
  // menghasilkan "user tidak ditemukan" palsu.
  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE LOWER(email) = LOWER(?)`,
      [email.trim()],
    );
    return row ? toRecord(row) : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const row = await this.db.queryOne<{ hit: number }>(
      'SELECT 1 AS hit FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [email.trim()],
    );
    return row !== null;
  }

  async create(data: CreateUserRecord): Promise<UserRecord> {
    const result = await this.db.execute(
      'INSERT INTO users (name, email, password_hash, role, phone, address, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        data.name,
        data.email,
        data.password_hash,
        data.role,
        data.phone ?? null,
        data.address ?? null,
        data.is_active === false ? 0 : 1,
      ],
    );

    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error('Gagal membaca pengguna setelah disimpan');
    }
    return created;
  }

  async update(id: number, data: UpdateUserRecord): Promise<UserRecord | null> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      params.push(data.name);
    }
    if (data.email !== undefined) {
      fields.push('email = ?');
      params.push(data.email);
    }
    if (data.password_hash !== undefined) {
      fields.push('password_hash = ?');
      params.push(data.password_hash);
    }
    if (data.role !== undefined) {
      fields.push('role = ?');
      params.push(data.role);
    }
    if (data.phone !== undefined) {
      fields.push('phone = ?');
      params.push(data.phone);
    }
    if (data.address !== undefined) {
      fields.push('address = ?');
      params.push(data.address);
    }
    if (data.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    const result = await this.db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.db.execute('DELETE FROM users WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // Dipakai test/integrasi: memastikan role yang dibaca cocok dengan daftar sah.
  static isValidRole(role: unknown): role is Role {
    return Object.values(RoleValues).includes(role as Role);
  }
}

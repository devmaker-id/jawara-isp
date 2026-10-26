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

// Filter daftar pengguna. `page`/`limit` opsional: tanpa keduanya repository
// mengembalikan seluruh hasil (dipakai kode lama).
export interface UserQuery {
  search?: string;
  role?: Role;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

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

  // Daftar dengan pencarian/filter/pagination. Semua nilai di-bind sebagai
  // parameter — tidak ada string SQL yang disusun dari input pengguna.
  async findPage(query: UserQuery): Promise<{ rows: UserRecord[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];

    const search = query.search?.trim();
    if (search) {
      where.push('(name LIKE ? OR email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (query.role) {
      where.push('role = ?');
      params.push(query.role);
    }
    if (query.isActive !== undefined) {
      where.push('is_active = ?');
      params.push(query.isActive ? 1 : 0);
    }

    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const totalRow = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM users${clause}`,
      params,
    );
    const total = totalRow ? Number(totalRow.total) : 0;

    let sql = `SELECT ${COLUMNS} FROM users${clause} ORDER BY id ASC`;
    const listParams = [...params];
    if (query.limit !== undefined) {
      const limit = Math.max(1, Math.min(200, Math.trunc(query.limit)));
      const page = Math.max(1, Math.trunc(query.page ?? 1));
      sql += ' LIMIT ? OFFSET ?';
      listParams.push(limit, (page - 1) * limit);
    }

    const rows = await this.db.query<UserRow>(sql, listParams);
    return { rows: rows.map(toRecord), total };
  }

  // Jumlah admin aktif SELAIN id tertentu. Dipakai untuk menolak penurunan
  // role/penonaktifan admin terakhir.
  async countActiveAdminsExcept(id: number): Promise<number> {
    const row = await this.db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
      [id],
    );
    return row ? Number(row.total) : 0;
  }

  // Apakah akun ini sudah terpakai sebagai jejak audit/petugas transaksi,
  // atau masih memiliki data layanan (bandwidth/group/profil)?
  // Menghapus akun seperti itu akan menghapus riwayat audit atau membuat
  // paketnya kehilangan pemilik, jadi penghapusan harus ditolak dan akun
  // dinonaktifkan saja.
  async countReferences(id: number): Promise<number> {
    const checks = [
      'SELECT COUNT(*) AS total FROM audit_logs WHERE user_id = ?',
      'SELECT COUNT(*) AS total FROM payments WHERE recorded_by = ? OR voided_by = ?',
      // Kepemilikan data layanan: FK-nya SET NULL (data selamat), tetapi
      // pemilik yang hilang membuat paket tidak terkelola. Lebih baik ditolak.
      'SELECT COUNT(*) AS total FROM bandwidth_profiles WHERE owner_id = ?',
      'SELECT COUNT(*) AS total FROM group_profiles WHERE owner_id = ?',
      'SELECT COUNT(*) AS total FROM hotspot_profiles WHERE owner_id = ?',
      'SELECT COUNT(*) AS total FROM ppp_profiles WHERE owner_id = ?',
    ];
    let total = 0;
    for (const sql of checks) {
      try {
        const row = await this.db.queryOne<{ total: number }>(
          sql,
          sql.includes('voided_by') ? [id, id] : [id],
        );
        total += row ? Number(row.total) : 0;
      } catch (error) {
        // Tabel belum ada (mis. payments sebelum migrasi) → anggap tidak ada
        // referensi, bukan menggagalkan penghapusan akun yang belum terpakai.
        const code = (error as { code?: string })?.code;
        if (code !== 'ER_NO_SUCH_TABLE') throw error;
      }
    }
    return total;
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

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
  /** Administrator utama: satu-satunya akun yang tidak boleh dihapus. */
  is_primary: boolean;
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
  is_primary: number | boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, name, email, password_hash, role, phone, address, is_active, is_primary, created_at, updated_at';

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
    is_primary: row.is_primary === 1 || row.is_primary === true,
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

  /**
   * Rincian data yang masih terikat pada akun ini.
   *
   * Dikembalikan per sumber (bukan satu angka) supaya operator tahu APA yang
   * menghalangi penghapusan — "3 pelanggan dan 12 voucher" jauh lebih berguna
   * daripada "ada 15 referensi".
   *
   * Semua sumber dihitung: jejak audit, transaksi, dan WARISAN kepemilikan
   * (pelanggan, voucher, profil, perangkat) — karena akun pemilik yang dihapus
   * membuat data itu kehilangan penanggung jawab.
   */
  async referenceBreakdown(id: number): Promise<Array<{ label: string; count: number }>> {
    const checks: Array<{ label: string; sql: string; params: number[] }> = [
      { label: 'pelanggan', sql: 'SELECT COUNT(*) AS total FROM customers WHERE owner_id = ?', params: [id] },
      {
        label: 'pelanggan (pencatat)',
        sql: 'SELECT COUNT(*) AS total FROM customers WHERE created_by = ?',
        params: [id],
      },
      { label: 'voucher', sql: 'SELECT COUNT(*) AS total FROM radius_vouchers WHERE owner_id = ?', params: [id] },
      {
        label: 'voucher (pencatat)',
        sql: 'SELECT COUNT(*) AS total FROM radius_vouchers WHERE created_by = ?',
        params: [id],
      },
      {
        label: 'bandwidth profile',
        sql: 'SELECT COUNT(*) AS total FROM bandwidth_profiles WHERE owner_id = ? OR created_by = ?',
        params: [id, id],
      },
      {
        label: 'group profile',
        sql: 'SELECT COUNT(*) AS total FROM group_profiles WHERE owner_id = ? OR created_by = ?',
        params: [id, id],
      },
      {
        label: 'profil hotspot',
        sql: 'SELECT COUNT(*) AS total FROM hotspot_profiles WHERE owner_id = ? OR created_by = ?',
        params: [id, id],
      },
      {
        label: 'profil PPP',
        sql: 'SELECT COUNT(*) AS total FROM ppp_profiles WHERE owner_id = ? OR created_by = ?',
        params: [id, id],
      },
      {
        label: 'perangkat OLT',
        sql: 'SELECT COUNT(*) AS total FROM olt_devices WHERE created_by = ?',
        params: [id],
      },
      {
        label: 'riwayat audit',
        sql: 'SELECT COUNT(*) AS total FROM audit_logs WHERE user_id = ?',
        params: [id],
      },
      {
        label: 'pembayaran',
        sql: 'SELECT COUNT(*) AS total FROM payments WHERE recorded_by = ? OR voided_by = ?',
        params: [id, id],
      },
      {
        label: 'permintaan persetujuan',
        sql: 'SELECT COUNT(*) AS total FROM approval_requests WHERE requested_by = ? OR decided_by = ?',
        params: [id, id],
      },
    ];

    const result: Array<{ label: string; count: number }> = [];
    for (const check of checks) {
      try {
        const row = await this.db.queryOne<{ total: number }>(check.sql, check.params);
        const count = row ? Number(row.total) : 0;
        if (count > 0) result.push({ label: check.label, count });
      } catch (error) {
        // Tabel belum ada (mis. instalasi lama sebelum migrasi) → anggap tidak
        // ada referensi; jangan gagalkan penghapusan akun yang belum terpakai.
        const code = (error as { code?: string })?.code;
        if (code !== 'ER_NO_SUCH_TABLE' && code !== 'ER_BAD_FIELD_ERROR') throw error;
      }
    }
    return result;
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

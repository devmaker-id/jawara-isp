import { Injectable } from '@nestjs/common';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { ownerFilter, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import {
  CUSTOMER_STATUSES,
  CustomerStatus,
  statusCheckAttributes,
  voucherStatusFor,
} from './customer-radius';

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  /** Status sebenarnya: active/expired/suspend/disable. */
  status: CustomerStatus;
  /** Akun pemilik data (admin/operator/reseller). null = data internal. */
  owner_id: number | null;
  /** Nama pemilik, diambil dari tabel users. */
  owner_name: string | null;
  /** Akun yang membuat baris ini. null = dibuat sebelum jejak dicatat. */
  created_by: number | null;
  created_by_name: string | null;
  created_at: Date;
  /** Akun RADIUS milik pelanggan ini (identitas layanan yang sebenarnya). */
  accounts?: CustomerAccount[];
}

/** Satu akun RADIUS yang tertaut ke pelanggan. */
export interface CustomerAccount {
  id: number;
  username: string;
  /** Hanya diisi pada detail pelanggan, tidak pernah pada daftar. */
  password?: string;
  profile_type: 'hotspot' | 'ppp';
  profile_id: number;
  profile_name: string;
  user_type: string;
  status: string;
  expires_at: Date | null;
  /** Sesi yang masih terbuka menurut radacct, bukan menurut perangkat. */
  online: boolean;
  last_seen: Date | null;
}

interface CustomerRow extends RowDataPacket {
  id: number;
  owner_id: number | null;
  owner_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: number | boolean;
  status: string | null;
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
    status: normaliseStatus(row.status),
    owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    owner_name: (row.owner_name as string | null) ?? null,
    created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
    created_by_name: (row.created_by_name as string | null) ?? null,
    created_at: row.created_at,
  };
}

// Nama pemilik & pembuat lewat subquery, bukan JOIN: klausa WHERE/COUNT yang
// sudah ada tidak perlu diubah dan tidak ada risiko baris berlipat.
const COLUMNS =
  'id, name, email, phone, address, is_active, status, created_at, owner_id, created_by, ' +
  '(SELECT u.name FROM users u WHERE u.id = customers.owner_id) AS owner_name, ' +
  '(SELECT u.name FROM users u WHERE u.id = customers.created_by) AS created_by_name';

/** Baris status dari database bisa null pada data lama; anggap 'active'. */
export function normaliseStatus(value: string | null | undefined): CustomerStatus {
  const text = (value ?? '').trim().toLowerCase();
  return (CUSTOMER_STATUSES as readonly string[]).includes(text)
    ? (text as CustomerStatus)
    : 'active';
}

// Akun RADIUS per pelanggan. `radacct` dipakai untuk status online karena
// sesi yang benar-benar tercatat AAA, bukan tabel lain yang tidak pernah diisi.
const ACCOUNT_COLUMNS = `v.id, v.username, v.profile_type, v.profile_id, v.profile_name,
  v.user_type, v.status, v.expires_at,
  EXISTS(SELECT 1 FROM radacct a WHERE a.username = v.username AND a.acctstoptime IS NULL) AS online,
  (SELECT MAX(a.acctstarttime) FROM radacct a WHERE a.username = v.username) AS last_seen`;

/** Satu baris akun RADIUS → objek API. */
function toAccount(row: RowDataPacket, withPassword = false): CustomerAccount {
  return {
    id: Number(row.id),
    username: String(row.username),
    ...(withPassword ? { password: String(row.password ?? '') } : {}),
    profile_type: row.profile_type as 'hotspot' | 'ppp',
    profile_id: Number(row.profile_id),
    profile_name: String(row.profile_name ?? ''),
    user_type: String(row.user_type ?? ''),
    status: String(row.status ?? ''),
    expires_at: (row.expires_at as Date | null) ?? null,
    online: Number(row.online) === 1,
    last_seen: (row.last_seen as Date | null) ?? null,
  };
}

// Filter daftar pelanggan. `page`/`limit` opsional agar pemanggil lama tetap
// menerima array biasa.
export interface CustomerQuery {
  search?: string;
  status?: 'active' | 'inactive';
  /** Status pelanggan yang sebenarnya. */
  state?: CustomerStatus;
  /** Hanya pelanggan yang punya akun dengan tipe layanan ini. */
  profile?: 'hotspot' | 'ppp';
  page?: number;
  limit?: number;
}

export interface CustomerRelations {
  invoices: number;
  services: number;
}

// Dilempar saat kolom customers.owner_id belum ada (migrasi 003/020 belum
// dijalankan). Service menerjemahkannya menjadi 503 yang jujur, bukan sukses
// palsu.
export class OwnerColumnMissingError extends Error {
  constructor() {
    super('Kolom customers.owner_id belum tersedia');
    this.name = 'OwnerColumnMissingError';
  }
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(
    scope: RequestScope = SYSTEM_SCOPE,
    profile?: 'hotspot' | 'ppp',
  ): Promise<Customer[]> {
    const owner = ownerFilter(scope, 'customers');
    const where: string[] = [];
    const params: unknown[] = [];
    if (owner.sql) {
      where.push(owner.sql);
      params.push(...owner.params);
    }
    if (profile) {
      where.push(
        'EXISTS (SELECT 1 FROM radius_vouchers v WHERE v.customer_id = customers.id AND v.profile_type = ?)',
      );
      params.push(profile);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers${clause} ORDER BY id DESC`,
      params,
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
    if (query.state) {
      where.push('status = ?');
      params.push(query.state);
    }
    // Filter tipe layanan: pelanggan yang punya akun hotspot / PPPoE.
    if (query.profile) {
      where.push(
        'EXISTS (SELECT 1 FROM radius_vouchers v WHERE v.customer_id = customers.id AND v.profile_type = ?)',
      );
      params.push(query.profile);
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
    const list = rows.map(toCustomer);
    // Satu query untuk semua akun di halaman ini, bukan satu query per baris.
    if (list.length > 0) {
      const ids = list.map((row) => row.id);
      const accounts = await this.db.query<RowDataPacket>(
        `SELECT v.customer_id, ${ACCOUNT_COLUMNS}
           FROM radius_vouchers v
          WHERE v.customer_id IN (${ids.map(() => '?').join(',')})
          ORDER BY v.username`,
        ids,
      );
      const byCustomer = new Map<number, CustomerAccount[]>();
      for (const row of accounts) {
        const key = Number(row.customer_id);
        const entry = toAccount(row);
        byCustomer.set(key, [...(byCustomer.get(key) ?? []), entry]);
      }
      for (const row of list) row.accounts = byCustomer.get(row.id) ?? [];
    }
    return {
      rows: list,
      total: totalRow ? Number(totalRow.total) : 0,
    };
  }

  /** Akun RADIUS milik satu pelanggan, lengkap dengan status online. */
  async findAccounts(customerId: number, withPassword = true): Promise<CustomerAccount[]> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT ${ACCOUNT_COLUMNS}, v.password FROM radius_vouchers v
        WHERE v.customer_id = ? ORDER BY v.username`,
      [customerId],
    );
    return rows.map((row) => toAccount(row, withPassword));
  }

  // Apakah kolom kepemilikan reseller sudah ada di database ini?
  async hasOwnerColumn(): Promise<boolean> {
    const row = await this.db.queryOne<{ hit: number }>(
      `SELECT 1 AS hit FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
          AND COLUMN_NAME IN ('owner_id', 'reseller_id')
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
    // Akun RADIUS dihitung untuk ditampilkan, tetapi TIDAK menghalangi hapus:
    // akun adalah bagian dari pelanggan dan ikut dicabut di remove().
    // Riwayat sesi di radacct tetap tersimpan karena kuncinya username.
    const services = await this.db.queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM radius_vouchers WHERE customer_id = ?',
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
        'SELECT owner_id FROM customers WHERE id = ? FOR UPDATE',
        [customerId],
      );
      if (current.length === 0) {
        const missing = new Error('Pelanggan tidak ditemukan');
        (missing as { code?: string }).code = 'CUSTOMER_NOT_FOUND';
        throw missing;
      }
      const previousOwnerId =
        current[0].owner_id === null || current[0].owner_id === undefined
          ? null
          : Number(current[0].owner_id);

      await conn.query('UPDATE customers SET owner_id = ? WHERE id = ?', [
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

  // -------------------------------------------------------------------------
  // Akun RADIUS milik pelanggan
  // -------------------------------------------------------------------------

  /** Profil layanan (hotspot/ppp) yang dipilih; sumber nama grup RADIUS-nya. */
  async findProfile(
    type: 'hotspot' | 'ppp',
    id: number,
  ): Promise<{
    id: number;
    name: string;
    group_profile_id: number;
    radius_group: string | null;
    is_active: number;
    owner_id: number | null;
    sell_price: number;
    promo_price: number;
    tax_percent: number;
  } | null> {
    const table = type === 'hotspot' ? 'hotspot_profiles' : 'ppp_profiles';
    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT id, name, group_profile_id, radius_group, is_active, owner_id,
              sell_price, promo_price, tax_percent
         FROM ${table} WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      id: Number(row.id),
      name: String(row.name),
      group_profile_id: Number(row.group_profile_id),
      radius_group: (row.radius_group as string | null) ?? null,
      is_active: Number(row.is_active ?? 1),
      owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
      sell_price: Number(row.sell_price ?? 0),
      promo_price: Number(row.promo_price ?? 0),
      tax_percent: Number(row.tax_percent ?? 0),
    };
  }

  async findAccountByUsername(username: string): Promise<{ id: number; customer_id: number | null } | null> {
    const row = await this.db.queryOne<RowDataPacket>(
      'SELECT id, customer_id FROM radius_vouchers WHERE username = ?',
      [username],
    );
    return row
      ? {
          id: Number(row.id),
          customer_id: row.customer_id === null ? null : Number(row.customer_id),
        }
      : null;
  }

  /**
   * Menulis satu akun ke tabel FreeRADIUS.
   *
   * radcheck   → password + atribut penolak menurut status pelanggan
   * radusergroup → grup dengan nama profil (atribut grup sudah ada di radgroupreply)
   * radreply   → limitasi PER USER (Session-Timeout, Mikrotik-Total-Limit)
   *
   * Seluruh isi ketiga tabel untuk username ini ditulis ulang, sehingga
   * perubahan status/limit tidak meninggalkan atribut lama yang menempel.
   */
  private async writeAccountRadius(
    conn: PoolConnection,
    input: {
      username: string;
      password: string;
      groupname: string;
      status: CustomerStatus;
      expiresAt?: Date | null;
    },
  ): Promise<void> {
    await conn.query('DELETE FROM radcheck WHERE username = ?', [input.username]);
    await conn.query('DELETE FROM radreply WHERE username = ?', [input.username]);
    await conn.query('DELETE FROM radusergroup WHERE username = ?', [input.username]);

    await conn.query(
      `INSERT INTO radcheck (username, attribute, op, value)
       VALUES (?, 'Cleartext-Password', ':=', ?)`,
      [input.username, input.password],
    );
    for (const row of statusCheckAttributes(input.status, input.expiresAt)) {
      await conn.query(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        [input.username, row.attribute, row.op, row.value],
      );
    }

    await conn.query(
      'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
      [input.username, input.groupname],
    );

    // radreply sengaja dibiarkan kosong: limitasi melekat pada grup
    // (radgroupreply), bukan pada user. Menulisnya di sini akan membuat dua
    // sumber angka yang bisa berbeda.
  }

  private async removeAccountRadius(conn: PoolConnection, username: string): Promise<void> {
    await conn.query('DELETE FROM radcheck WHERE username = ?', [username]);
    await conn.query('DELETE FROM radreply WHERE username = ?', [username]);
    await conn.query('DELETE FROM radusergroup WHERE username = ?', [username]);
  }

  // -------------------------------------------------------------------------
  // CRUD pelanggan (beserta akun RADIUS-nya)
  // -------------------------------------------------------------------------

  /**
   * Buat pelanggan + akun RADIUS dalam satu transaksi.
   *
   * Kalau penulisan RADIUS gagal, pelanggan ikut dibatalkan: lebih baik tidak
   * ada data sama sekali daripada pelanggan tanpa akun yang bisa login.
   */
  async create(
    dto: CreateCustomerDto,
    options: {
      status: CustomerStatus;
      account?: {
        profile: { id: number; name: string; group_profile_id: number; radius_group: string | null };
        type: 'hotspot' | 'ppp';
        username: string;
        password: string;
        price: number;
        taxAmount: number;
      };
      actorId: number;
    },
  ): Promise<number> {
    return this.db.withTransaction(async (conn) => {
      const columns = ['name', 'email', 'phone', 'address', 'is_active', 'status'];
      const params: unknown[] = [
        dto.name,
        dto.email,
        dto.phone,
        dto.address ?? '',
        options.status === 'active' ? 1 : 0,
        options.status,
      ];
      // Pemilik: null berarti data internal (tanpa pemilik). Ditulis eksplisit
      // supaya pewarisan dari profil tidak hilang saat nilainya null.
      columns.push('owner_id');
      params.push(dto.owner_id ?? null);

      // Pembuat SELALU dari token, tidak pernah dari body.
      if (options.actorId > 0) {
        columns.push('created_by');
        params.push(options.actorId);
      }

      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO customers (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        params,
      );
      const customerId = result.insertId;

      const account = options.account;
      if (account) {
        const groupname = account.profile.radius_group ?? account.profile.name;
        await conn.query(
          `INSERT INTO radius_vouchers
             (profile_type, profile_id, group_profile_id, profile_name, user_type, username,
              password, customer_id, status, price, tax_amount, expires_at, created_by, owner_id)
           VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [
            account.type,
            account.profile.id,
            account.profile.group_profile_id,
            account.profile.name,
            account.username,
            account.password,
            customerId,
            voucherStatusFor(options.status),
            account.price,
            account.taxAmount,
            options.actorId,
            // Akun ini milik pemilik pelanggan, bukan pemilik profil: pelanggan
            // bisa dipindahkan antar reseller tanpa memindahkan profilnya.
            dto.owner_id ?? null,
          ],
        );

        await this.writeAccountRadius(conn, {
          username: account.username,
          password: account.password,
          groupname,
          status: options.status,
        });
      }

      return customerId;
    });
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
      // is_active hanyalah cermin: nilai sebenarnya ada di status.
      fields.push('status = ?');
      params.push(dto.is_active ? 'active' : 'disable');
    }
    if (dto.status !== undefined) {
      fields.push('status = ?');
      params.push(dto.status);
      // Jaga is_active tetap sinkron agar filter lama tidak menyesatkan.
      fields.push('is_active = ?');
      params.push(dto.status === 'active' ? 1 : 0);
    }

    if (fields.length > 0) {
      params.push(id);
      const result = await this.db.execute(
        `UPDATE customers SET ${fields.join(', ')} WHERE id = ?`,
        params,
      );
      if (result.affectedRows === 0) return null;
    }

    // Setiap perubahan status WAJIB sampai ke RADIUS, kalau tidak akun yang
    // di-suspend tetap bisa login. Perubahan akun (profil/limit) juga ikut
    // disetel ulang di sini.
    if (dto.status !== undefined || dto.is_active !== undefined || dto.account) {
      await this.syncAccounts(id);
    }
    return this.findById(id);
  }

  /**
   * Ubah akun RADIUS milik pelanggan (profil, limit). Username & password hanya
   * diubah bila dikirim — keduanya identitas yang dipakai pelanggan untuk login.
   */
  async updateAccount(
    customerId: number,
    input: {
      profile?: { id: number; name: string; group_profile_id: number; radius_group: string | null };
      type?: 'hotspot' | 'ppp';
      username?: string;
      password?: string;
      status: CustomerStatus;
      price?: number;
      taxAmount?: number;
    },
  ): Promise<number> {
    const accounts = await this.db.query<RowDataPacket>(
      'SELECT id, username FROM radius_vouchers WHERE customer_id = ? ORDER BY id LIMIT 1',
      [customerId],
    );
    const current = accounts[0];
    if (!current) return 0;

    const fields: string[] = [];
    const params: unknown[] = [];
    if (input.profile && input.type) {
      // radius_group tidak disimpan di baris akun: nilainya selalu dibaca dari
      // tabel profil saat sinkronisasi, jadi cukup perbarui rujukannya.
      fields.push('profile_type = ?', 'profile_id = ?', 'group_profile_id = ?', 'profile_name = ?');
      params.push(input.type, input.profile.id, input.profile.group_profile_id, input.profile.name);
    }
    // Username tidak diubah setelah dibuat: ia identitas yang dipakai pelanggan
    // untuk login dan kunci riwayat di radacct. Ganti = buat akun baru.
    if (input.password !== undefined) {
      fields.push('password = ?');
      params.push(input.password);
    }
    if (input.price !== undefined) {
      fields.push('price = ?');
      params.push(input.price);
    }
    if (input.taxAmount !== undefined) {
      fields.push('tax_amount = ?');
      params.push(input.taxAmount);
    }
    if (fields.length === 0) return Number(current.id);

    params.push(current.id);
    await this.db.execute(
      `UPDATE radius_vouchers SET ${fields.join(', ')} WHERE id = ?`,
      params,
    );
    return Number(current.id);
  }

  /**
   * Tulis ulang seluruh akun milik pelanggan sesuai status & batas yang
   * tersimpan. Dipanggil setelah status, profil, atau limit diubah.
   */
  async syncAccounts(customerId: number): Promise<void> {
    const customer = await this.db.queryOne<RowDataPacket>(
      'SELECT status FROM customers WHERE id = ?',
      [customerId],
    );
    if (!customer) return;
    const status = normaliseStatus(customer.status as string | null);

    const accounts = await this.db.query<RowDataPacket>(
      `SELECT v.username, v.password, v.profile_name, v.profile_type, v.profile_id,
              v.expires_at, p.radius_group
         FROM radius_vouchers v
         LEFT JOIN hotspot_profiles p
           ON v.profile_type = 'hotspot' AND p.id = v.profile_id
        WHERE v.customer_id = ?`,
      [customerId],
    );

    // Grup PPP diambil terpisah: satu LEFT JOIN tidak bisa menunjuk dua tabel.
    const ppp = await this.db.query<RowDataPacket>(
      `SELECT v.username, p.radius_group FROM radius_vouchers v
         JOIN ppp_profiles p ON p.id = v.profile_id
        WHERE v.customer_id = ? AND v.profile_type = 'ppp'`,
      [customerId],
    );
    const pppGroup = new Map(ppp.map((row) => [String(row.username), row.radius_group as string | null]));

    await this.db.withTransaction(async (conn) => {
      for (const row of accounts) {
        const username = String(row.username);
        const groupname =
          (row.radius_group as string | null) ??
          pppGroup.get(username) ??
          String(row.profile_name ?? '');

        await this.writeAccountRadius(conn, {
          username,
          password: String(row.password ?? ''),
          groupname,
          status,
          expiresAt: (row.expires_at as Date | null) ?? null,
        });

        await conn.query('UPDATE radius_vouchers SET status = ? WHERE username = ?', [
          voucherStatusFor(status),
          username,
        ]);
      }
    });
  }

  async remove(id: number): Promise<boolean> {
    return this.db.withTransaction(async (conn) => {
      // Akun RADIUS dicabut lebih dulu: kalau pelanggan hilang tanpa ini,
      // username-nya tetap bisa login walau tidak ada pemiliknya.
      const accounts = await conn.query<RowDataPacket[]>(
        'SELECT username FROM radius_vouchers WHERE customer_id = ?',
        [id],
      );
      for (const row of accounts[0] ?? []) {
        await this.removeAccountRadius(conn, String(row.username));
      }
      await conn.query('DELETE FROM radius_vouchers WHERE customer_id = ?', [id]);
      const [result] = await conn.query<ResultSetHeader>('DELETE FROM customers WHERE id = ?', [id]);
      return result.affectedRows > 0;
    });
  }
}

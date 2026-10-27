import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AssignOwnerDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import {
  Customer,
  CustomerQuery,
  CustomersRepository,
  OwnerColumnMissingError,
} from './customers.repository';
import { finalPrice } from '../profiles/profile-mapping';
import { UsersRepository } from '../users/users.repository';
import { isMissingOwnerColumn, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { PermissionsService } from '../permissions/permissions.service';
import { ApprovalService } from '../permissions/approval.service';

export type { Customer };

/** Aktor yang menjalankan mutasi, diambil dari token — bukan dari body. */
export type CustomerActor = { userId: number; role?: string; ip: string };

// Karakter password: tanpa 0/O/1/I/L agar tidak salah baca saat disampaikan
// ke pelanggan lewat telepon atau pesan.
const PASSWORD_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generatePassword(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)];
  return out;
}

// Kode error MySQL yang perlu diterjemahkan jadi respons HTTP jelas,
// bukan 500 berisi stack trace.
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';
// Kunci asing: pemilik yang dirujuk tidak ada di tabel users.
const ER_NO_REFERENCED_ROW = 'ER_NO_REFERENCED_ROW_2';
const DB_UNAVAILABLE = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ENOTFOUND',
];

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

@Injectable()
export class CustomersService {
  static readonly OWNER_DISABLED_MESSAGE =
    'Penetapan pemilik pelanggan belum aktif: kolom customers.owner_id belum ada. ' +
    'Migrasi 003_customer_reseller_ownership.sql belum dijalankan.';

  constructor(
    private readonly repository: CustomersRepository,
    private readonly users: UsersRepository,
    private readonly permissions: PermissionsService,
    private readonly approval: ApprovalService,
  ) {}

  // Tanpa `page` hasil tetap array (kompatibel dengan klien lama).
  // Dengan `page` hasil dipaginasi: { rows, total, page, limit }.
  async list(
    query: CustomerQuery,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<Customer[] | { rows: Customer[]; total: number; page: number; limit: number }> {
    if (query.page === undefined) {
      const rows = await this.repository
        .findAll(scope, query.profile)
        .catch((error) => this.rethrow(error));
      const needle = query.search?.trim().toLowerCase();
      return rows.filter((customer) => {
        if (query.status === 'active' && !customer.is_active) return false;
        if (query.status === 'inactive' && customer.is_active) return false;
        if (query.state && customer.status !== query.state) return false;
        if (!needle) return true;
        return `${customer.name} ${customer.email} ${customer.phone}`
          .toLowerCase()
          .includes(needle);
      });
    }

    // Batas 1000 mengikuti pilihan "tampilkan" di panel (25/50/100/500/1000).
    // Dibatasi tetap: satu permintaan tidak boleh menarik seluruh tabel.
    const limit = Math.max(1, Math.min(1000, query.limit ?? 25));
    const page = Math.max(1, query.page);
    const { rows, total } = await this.repository
      .findPage({ ...query, page, limit }, scope)
      .catch((error) => this.rethrow(error));
    return { rows, total, page, limit };
  }

  // Kemampuan fitur kepemilikan (dipakai UI agar tidak menampilkan kontrol
  // yang belum bisa bekerja).
  async ownerCapability(): Promise<{ owner_assignment: boolean }> {
    const available = await this.repository
      .hasOwnerColumn()
      .catch((error) => this.rethrow(error));
    return { owner_assignment: available };
  }

  async assignOwner(
    customerId: number,
    dto: AssignOwnerDto,
    actor: { userId: number; ip: string },
  ): Promise<{ ok: true; customer_id: number; previous_owner_id: number | null; owner_id: number | null }> {
    if (!(await this.repository.hasOwnerColumn().catch((error) => this.rethrow(error)))) {
      throw new ServiceUnavailableException(CustomersService.OWNER_DISABLED_MESSAGE);
    }

    // Pelanggan harus ada.
    await this.requireCustomer(customerId);

    // Pemilik baru harus akun aktif. Role-nya boleh admin/operator/reseller:
    // setelah operator juga bisa menjadi pemilik, membatasi ke reseller saja
    // akan menolak penugasan yang sah.
    if (dto.owner_id !== null) {
      const owner = await this.users.findById(dto.owner_id).catch((error) => this.rethrow(error));
      if (!owner) {
        throw new BadRequestException(`Akun pemilik dengan ID ${dto.owner_id} tidak ditemukan`);
      }
      if (!owner.is_active) {
        throw new BadRequestException(`Akun ${owner.email} tidak aktif dan tidak dapat ditugaskan`);
      }
    }

    try {
      const { previousOwnerId } = await this.repository.assignOwner(customerId, dto.owner_id, actor);
      return {
        ok: true,
        customer_id: customerId,
        previous_owner_id: previousOwnerId,
        owner_id: dto.owner_id,
      };
    } catch (error) {
      if (error instanceof OwnerColumnMissingError) {
        throw new ServiceUnavailableException(CustomersService.OWNER_DISABLED_MESSAGE);
      }
      if (errorCode(error) === 'CUSTOMER_NOT_FOUND') {
        throw new NotFoundException(`Pelanggan dengan ID ${customerId} tidak ditemukan`);
      }
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (isMissingOwnerColumn(error)) {
      throw new ServiceUnavailableException(CustomersService.OWNER_DISABLED_MESSAGE);
    }
    const code = errorCode(error);
    if (code === ER_DUP_ENTRY) {
      throw new ConflictException('Email sudah terdaftar pada pelanggan lain');
    }
    if (code === ER_NO_REFERENCED_ROW) {
      // Terjadi bila akun pemilik yang dirujuk sudah tidak ada. Lebih jelas
      // daripada 500 berisi detail kunci asing.
      throw new BadRequestException(
        'Akun pemilik pelanggan tidak ditemukan di tabel pengguna. ' +
          'Pilih pemilik lain atau kosongkan.',
      );
    }
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  findAll(): Promise<Customer[]> {
    return this.repository.findAll().catch((error) => this.rethrow(error));
  }

  async findOne(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Customer> {
    const customer = await this.requireCustomer(id, scope);
    return {
      ...customer,
      accounts: await this.repository.findAccounts(id).catch((error) => this.rethrow(error)),
    };
  }

  /**
   * Ambil pelanggan tanpa memuat akun RADIUS.
   *
   * Dipakai operasi internal (update/hapus/pindah pemilik) supaya tidak
   * menjalankan query akun yang tidak dibutuhkan.
   */
  private async requireCustomer(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Customer> {
    const customer = await this.repository.findById(id, scope).catch((error) => this.rethrow(error));
    if (!customer) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return customer;
  }

  /**
   * Akun RADIUS milik pelanggan — identitas layanan yang ditagih.
   *
   * Memeriksa keberadaan lewat repository, BUKAN lewat findOne(): findOne
   * memanggil method ini untuk mengisi `accounts`, sehingga lewat findOne
   * terjadi rekursi tanpa ujung.
   */
  async accounts(id: number, scope: RequestScope = SYSTEM_SCOPE) {
    await this.requireCustomer(id, scope);
    return this.repository.findAccounts(id).catch((error) => this.rethrow(error));
  }

  /**
   * Buat pelanggan beserta akun RADIUS-nya.
   *
   * Urutan yang penting: profil divalidasi lebih dulu (tipe harus cocok,
   * profil harus aktif), username dicek unik, baru pelanggan dan akun ditulis
   * dalam satu transaksi. Tanpa akun, pelanggan tidak akan pernah bisa login
   * dan tidak ada yang bisa ditagih.
   *
   * Aturan PEMILIK: hanya admin yang boleh memilih pemilik lain. Operator dan
   * reseller selalu menjadi pemilik data yang mereka buat — nilai dari body
   * ditimpa, bukan dipercaya.
   */
  async create(dto: CreateCustomerDto, actor?: CustomerActor): Promise<Customer> {
    const existing = await this.repository.findByEmail(dto.email).catch((error) => this.rethrow(error));
    if (existing) {
      throw new ConflictException('Email sudah terdaftar pada pelanggan lain');
    }

    const role = String(actor?.role ?? '');
    const isAdmin = role === 'admin';

    const status = dto.status ?? 'active';
    let account: Parameters<CustomersRepository['create']>[1]['account'];
    let profileOwnerId: number | null = null;

    if (dto.account) {
      const input = dto.account;
      const profile = await this.repository
        .findProfile(input.profile_type, input.profile_id)
        .catch((error) => this.rethrow(error));
      if (!profile) {
        throw new BadRequestException(
          `Profil ${input.profile_type} #${input.profile_id} tidak ditemukan. ` +
            'Pilih profil dari daftar sesuai tipe layanan.',
        );
      }
      if (profile.is_active === 0) {
        throw new BadRequestException(`Profil "${profile.name}" sedang nonaktif.`);
      }

      const username = input.username.trim();
      const taken = await this.repository
        .findAccountByUsername(username)
        .catch((error) => this.rethrow(error));
      if (taken) {
        throw new ConflictException(`Username "${username}" sudah dipakai akun lain.`);
      }

      // Pemilik profil dipakai sebagai nilai WARISAN bila admin tidak memilih
      // pemilik secara eksplisit.
      profileOwnerId = profile.owner_id ?? null;

      const password = (input.password ?? '').trim() || generatePassword();
      const price = finalPrice(profile);

      account = {
        profile,
        type: input.profile_type,
        username,
        password,
        price: price.base,
        taxAmount: price.tax,
      };
    }

    // Aturan pemilik:
    //   admin    → pilihan eksplisit; bila kosong, warisi dari profil
    //   lainnya  → selalu akun yang login (nilai body ditimpa)
    const effectiveOwner = isAdmin ? (dto.owner_id ?? profileOwnerId) : (actor?.userId ?? null);

    const id = await this.repository
      .create({ ...dto, owner_id: effectiveOwner }, { status, account, actorId: actor?.userId ?? 0 })
      .catch((error) => this.rethrow(error));

    return this.findOne(id);
  }

  /** Ubah status pelanggan: akun RADIUS ikut ditolak/diizinkan saat login. */
  async setStatus(
    id: number,
    status: 'active' | 'expired' | 'suspend' | 'disable',
  ): Promise<Customer> {
    await this.requireCustomer(id);
    await this.repository.update(id, { status }).catch((error) => this.rethrow(error));
    return this.findOne(id);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    const current = await this.requireCustomer(id);
    if (dto.email && dto.email !== current.email) {
      const existing = await this.repository.findByEmail(dto.email).catch((error) => this.rethrow(error));
      if (existing && existing.id !== id) {
        throw new ConflictException('Email sudah terdaftar pada pelanggan lain');
      }
    }

    // Perubahan pada akun (profil/limit/password) ditulis lebih dulu, lalu
    // repository menyetel ulang atribut RADIUS-nya.
    if (dto.account) {
      const existing = await this.repository
        .findAccounts(id, false)
        .catch((error) => this.rethrow(error));
      if (existing.length === 0) {
        throw new BadRequestException(
          'Pelanggan ini belum punya akun RADIUS. Buat pelanggan baru dengan akun, ' +
            'atau tambahkan akun lewat Layanan.',
        );
      }

      const input = dto.account;
      let profile: Awaited<ReturnType<CustomersRepository['findProfile']>> = null;
      if (input.profile_id !== undefined || input.profile_type !== undefined) {
        const type = input.profile_type ?? existing[0].profile_type;
        const profileId = input.profile_id ?? existing[0].profile_id;
        profile = await this.repository.findProfile(type, profileId).catch((error) => this.rethrow(error));
        if (!profile) {
          throw new BadRequestException(`Profil ${type} #${profileId} tidak ditemukan.`);
        }
      }

      const price = profile ? finalPrice(profile) : undefined;
      await this.repository
        .updateAccount(id, {
          profile: profile ?? undefined,
          type: profile ? (input.profile_type ?? existing[0].profile_type) : undefined,
          password: input.password?.trim() || undefined,
          status: (dto.status ?? current.status) as 'active' | 'expired' | 'suspend' | 'disable',
          price: price?.base,
          taxAmount: price?.tax,
        })
        .catch((error) => this.rethrow(error));
    }

    const updated = await this.repository.update(id, dto).catch((error) => this.rethrow(error));
    if (!updated) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return this.findOne(id);
  }

  /**
   * Hapus pelanggan — atau ajukan permintaan hapus.
   *
   * Satu jalur untuk dua kemungkinan, ditentukan izin `customer.delete`:
   *   punya izin → hapus langsung (dengan semua pemeriksaan relasi)
   *   tanpa izin → catat permintaan; data belum berubah sampai disetujui
   *
   * Dengan begitu tidak ada endpoint kedua yang bisa dipakai melewati aturan.
   */
  async removeOrRequest(
    id: number,
    actor: CustomerActor,
  ): Promise<{ ok: true } | { pending: true; request_id: number; message: string }> {
    await this.requireCustomer(id);
    const allowed = await this.permissions.can(actor.userId, actor.role ?? '', 'customer.delete');
    if (!allowed) {
      return this.approval.request({
        actorId: actor.userId,
        action: 'customer.delete',
        targetType: 'customer',
        targetId: id,
      });
    }
    return this.remove(id);
  }

  // Pelanggan yang punya tagihan tidak boleh dihapus: FK customers melakukan
  // CASCADE ke invoices, sehingga riwayat ikut hilang. Akun RADIUS ikut
  // dicabut bersama pelanggan, sedangkan riwayat sesi (radacct) tetap utuh
  // karena kuncinya username, bukan id pelanggan.
  async remove(id: number): Promise<{ ok: true }> {
    await this.requireCustomer(id);
    const relations = await this.repository.countRelations(id).catch((error) => this.rethrow(error));
    if (relations.invoices > 0) {
      throw new ConflictException(
        `Pelanggan memiliki ${relations.invoices} tagihan` +
          (relations.services > 0 ? ` dan ${relations.services} akun RADIUS` : '') +
          '. Nonaktifkan pelanggan (status disable) agar riwayat tidak hilang.',
      );
    }
    const deleted = await this.repository.remove(id).catch((error) => this.rethrow(error));
    if (!deleted) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AssignOwnerDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import {
  Customer,
  CustomerQuery,
  CustomersRepository,
  OwnerColumnMissingError,
} from './customers.repository';
import { UsersRepository } from '../users/users.repository';
import { isMissingOwnerColumn, RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';

export type { Customer };

// Kode error MySQL yang perlu diterjemahkan jadi respons HTTP jelas,
// bukan 500 berisi stack trace.
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';
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
  constructor(
    private readonly repository: CustomersRepository,
    private readonly users: UsersRepository,
  ) {}

  private static readonly OWNER_DISABLED_MESSAGE =
    'Penetapan pemilik pelanggan belum aktif: kolom customers.reseller_id belum ada. ' +
    'Migrasi 003_customer_reseller_ownership.sql belum dijalankan.';

  // Tanpa `page` hasil tetap array (kompatibel dengan klien lama).
  // Dengan `page` hasil dipaginasi: { rows, total, page, limit }.
  async list(
    query: CustomerQuery,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<Customer[] | { rows: Customer[]; total: number; page: number; limit: number }> {
    if (query.page === undefined) {
      const rows = await this.repository.findAll(scope).catch((error) => this.rethrow(error));
      const needle = query.search?.trim().toLowerCase();
      return rows.filter((customer) => {
        if (query.status === 'active' && !customer.is_active) return false;
        if (query.status === 'inactive' && customer.is_active) return false;
        if (!needle) return true;
        return `${customer.name} ${customer.email} ${customer.phone}`
          .toLowerCase()
          .includes(needle);
      });
    }

    const limit = Math.max(1, Math.min(200, query.limit ?? 20));
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
    await this.findOne(customerId);

    // Pemilik baru harus akun reseller yang valid & aktif. Role dibaca dari
    // database, bukan dari body request.
    if (dto.reseller_id !== null) {
      const owner = await this.users.findById(dto.reseller_id).catch((error) => this.rethrow(error));
      if (!owner) {
        throw new BadRequestException(`Akun reseller dengan ID ${dto.reseller_id} tidak ditemukan`);
      }
      // Nilai enum aktual di DB adalah 'resseler'; 'reseller' ditoleransi agar
      // tidak pecah bila enum dinormalisasi kelak.
      const ownerRole = owner.role as string;
      if (ownerRole !== 'resseler' && ownerRole !== 'reseller') {
        throw new BadRequestException(
          `Akun ${owner.email} bukan reseller (role saat ini: ${owner.role})`,
        );
      }
      if (!owner.is_active) {
        throw new BadRequestException(`Akun ${owner.email} tidak aktif dan tidak dapat ditugaskan`);
      }
    }

    try {
      const { previousOwnerId } = await this.repository.assignOwner(customerId, dto.reseller_id, actor);
      return {
        ok: true,
        customer_id: customerId,
        previous_owner_id: previousOwnerId,
        owner_id: dto.reseller_id,
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
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  findAll(): Promise<Customer[]> {
    return this.repository.findAll().catch((error) => this.rethrow(error));
  }

  async findOne(id: number, scope: RequestScope = SYSTEM_SCOPE): Promise<Customer> {
    const customer = await this.repository.findById(id, scope).catch((error) => this.rethrow(error));
    if (!customer) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const existing = await this.repository.findByEmail(dto.email).catch((error) => this.rethrow(error));
    if (existing) {
      throw new ConflictException('Email sudah terdaftar pada pelanggan lain');
    }
    return this.repository.create(dto).catch((error) => this.rethrow(error));
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    const current = await this.findOne(id);
    if (dto.email && dto.email !== current.email) {
      const existing = await this.repository.findByEmail(dto.email).catch((error) => this.rethrow(error));
      if (existing && existing.id !== id) {
        throw new ConflictException('Email sudah terdaftar pada pelanggan lain');
      }
    }
    const updated = await this.repository.update(id, dto).catch((error) => this.rethrow(error));
    if (!updated) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return updated;
  }

  // Pelanggan yang punya tagihan/sesi layanan tidak boleh dihapus: FK
  // customers melakukan CASCADE ke invoices & service_sessions, sehingga
  // riwayat ikut hilang. Arahkan ke penonaktifan (PATCH is_active=false).
  async remove(id: number): Promise<{ ok: true }> {
    await this.findOne(id);
    const relations = await this.repository.countRelations(id).catch((error) => this.rethrow(error));
    if (relations.invoices > 0 || relations.services > 0) {
      throw new ConflictException(
        `Pelanggan memiliki ${relations.invoices} tagihan dan ${relations.services} sesi layanan. ` +
          'Nonaktifkan pelanggan (status nonaktif) agar riwayat tidak hilang.',
      );
    }
    const deleted = await this.repository.remove(id).catch((error) => this.rethrow(error));
    if (!deleted) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}

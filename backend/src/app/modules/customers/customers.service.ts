import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { Customer, CustomersRepository } from './customers.repository';

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
  constructor(private readonly repository: CustomersRepository) {}

  private rethrow(error: unknown): never {
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

  async findOne(id: number): Promise<Customer> {
    const customer = await this.repository.findById(id).catch((error) => this.rethrow(error));
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

  async remove(id: number): Promise<{ ok: true }> {
    const deleted = await this.repository.remove(id).catch((error) => this.rethrow(error));
    if (!deleted) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CreatePackageDto, UpdatePackageDto } from './dto/package.dto';
import { Package, PackagesRepository } from './packages.repository';

export type { Package };

const DB_UNAVAILABLE = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ENOTFOUND',
  'ER_NO_SUCH_TABLE',
];

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

@Injectable()
export class PackagesService {
  constructor(private readonly repository: PackagesRepository) {}

  private rethrow(error: unknown): never {
    const code = errorCode(error);
    if (code === 'ER_DUP_ENTRY') {
      throw new ConflictException('Paket dengan nama tersebut sudah ada');
    }
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  findAll(): Promise<Package[]> {
    return this.repository.findAll().catch((error) => this.rethrow(error));
  }

  async findOne(id: number): Promise<Package> {
    const pkg = await this.repository.findById(id).catch((error) => this.rethrow(error));
    if (!pkg) {
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }
    return pkg;
  }

  async create(dto: CreatePackageDto): Promise<Package> {
    const existing = await this.repository
      .findByName(dto.name)
      .catch((error) => this.rethrow(error));
    if (existing) {
      throw new ConflictException('Paket dengan nama tersebut sudah ada');
    }
    return this.repository.create(dto).catch((error) => this.rethrow(error));
  }

  async update(id: number, dto: UpdatePackageDto): Promise<Package> {
    const current = await this.findOne(id);

    if (dto.name && dto.name.trim().toLowerCase() !== current.name.toLowerCase()) {
      const existing = await this.repository
        .findByName(dto.name)
        .catch((error) => this.rethrow(error));
      if (existing && existing.id !== id) {
        throw new ConflictException('Paket dengan nama tersebut sudah ada');
      }
    }

    const updated = await this.repository.update(id, dto).catch((error) => this.rethrow(error));
    if (!updated) {
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }
    return updated;
  }

  async remove(id: number): Promise<{ ok: true }> {
    const deleted = await this.repository.remove(id).catch((error) => this.rethrow(error));
    if (!deleted) {
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}

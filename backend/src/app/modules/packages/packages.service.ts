import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePackageDto, UpdatePackageDto } from './dto/package.dto';

export interface Package {
  id: number;
  name: string;
  description: string;
  price: number;
  data_limit: string;
  speed: number;
  valid_days: number;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
export class PackagesService {
  private packages: Package[] = [];

  findAll() {
    return this.packages;
  }

  findOne(id: number) {
    const pkg = this.packages.find((p) => p.id === id);
    if (!pkg) {
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }
    return pkg;
  }

  create(createDto: CreatePackageDto) {
    const now = new Date();
    const pkg: Package = {
      id: this.packages.length + 1,
      name: createDto.name,
      description: createDto.description,
      price: createDto.price,
      data_limit: createDto.data_limit,
      speed: createDto.speed,
      valid_days: createDto.valid_days,
      is_active: createDto.is_active !== false,
      created_at: now,
    };
    this.packages.push(pkg);
    return pkg;
  }

  update(id: number, updateDto: UpdatePackageDto) {
    const pkg = this.findOne(id);
    Object.assign(pkg, updateDto);
    return pkg;
  }

  remove(id: number) {
    const index = this.packages.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new NotFoundException(`Paket dengan ID ${id} tidak ditemukan`);
    }
    this.packages.splice(index, 1);
    return { ok: true };
  }
}

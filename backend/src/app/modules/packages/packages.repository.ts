import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
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

interface PackageRow {
  id: number;
  name: string;
  description: string;
  // DECIMAL(12,2): mysql2 mengembalikan string kecuali `decimalNumbers` aktif.
  price: number | string;
  data_limit: string;
  speed: number;
  valid_days: number;
  is_active: number | boolean;
  created_at: Date;
}

function toPackage(row: PackageRow): Package {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // Konversi eksplisit: jangan bergantung pada opsi driver saja, agar
    // presisi desimal tetap konsisten bila konfigurasi pool berubah.
    price: typeof row.price === 'string' ? Number(row.price) : row.price,
    data_limit: row.data_limit,
    speed: Number(row.speed),
    valid_days: Number(row.valid_days),
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: row.created_at,
  };
}

const COLUMNS =
  'id, name, description, price, data_limit, speed, valid_days, is_active, created_at';

@Injectable()
export class PackagesRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Package[]> {
    const rows = await this.db.query<PackageRow>(
      `SELECT ${COLUMNS} FROM packages ORDER BY id DESC`,
    );
    return rows.map(toPackage);
  }

  async findById(id: number): Promise<Package | null> {
    const row = await this.db.queryOne<PackageRow>(
      `SELECT ${COLUMNS} FROM packages WHERE id = ?`,
      [id],
    );
    return row ? toPackage(row) : null;
  }

  // Nama paket tidak UNIQUE di schema, jadi duplikat dicek di service agar
  // pesan errornya jelas (bukan mengandalkan error database).
  async findByName(name: string): Promise<Package | null> {
    const row = await this.db.queryOne<PackageRow>(
      `SELECT ${COLUMNS} FROM packages WHERE LOWER(name) = LOWER(?)`,
      [name.trim()],
    );
    return row ? toPackage(row) : null;
  }

  async create(dto: CreatePackageDto): Promise<Package> {
    const result = await this.db.execute(
      'INSERT INTO packages (name, description, price, data_limit, speed, valid_days, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        dto.name.trim(),
        dto.description,
        dto.price,
        dto.data_limit,
        dto.speed,
        dto.valid_days,
        dto.is_active === false ? 0 : 1,
      ],
    );

    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error('Gagal membaca paket setelah disimpan');
    }
    return created;
  }

  async update(id: number, dto: UpdatePackageDto): Promise<Package | null> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (dto.name !== undefined) {
      fields.push('name = ?');
      params.push(dto.name.trim());
    }
    if (dto.description !== undefined) {
      fields.push('description = ?');
      params.push(dto.description);
    }
    if (dto.price !== undefined) {
      fields.push('price = ?');
      params.push(dto.price);
    }
    if (dto.data_limit !== undefined) {
      fields.push('data_limit = ?');
      params.push(dto.data_limit);
    }
    if (dto.speed !== undefined) {
      fields.push('speed = ?');
      params.push(dto.speed);
    }
    if (dto.valid_days !== undefined) {
      fields.push('valid_days = ?');
      params.push(dto.valid_days);
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
      `UPDATE packages SET ${fields.join(', ')} WHERE id = ?`,
      params,
    );
    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.db.execute('DELETE FROM packages WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

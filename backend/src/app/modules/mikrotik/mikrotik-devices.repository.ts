import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  DEVICES_MIGRATION,
  MIKROTIK_DEVICE_SELECT,
  MikrotikDeviceRow,
  DeviceWriteData,
} from './models/mikrotik-device.model';

// Tabel daftar perangkat MikroTik. Kontrak kolom ada di
// models/mikrotik-device.model.ts (migrasi 005). Tabel BELUM dibuat di
// produksi; seluruh method di sini harus tahan terhadap kondisi "tabel belum
// ada" dan melaporkannya ke lapisan service (bukan melempar 500).
//
// Re-export dipertahankan agar pemanggil lama (test, service) tidak berubah.
export { DEVICES_MIGRATION };
export type { MikrotikDeviceRow, DeviceWriteData };

@Injectable()
export class MikrotikDevicesRepository {
  private readonly logger = new Logger(MikrotikDevicesRepository.name);
  private tableExists: boolean | null = null;

  constructor(private readonly db: DatabaseService) {}

  async hasTable(): Promise<boolean> {
    if (this.tableExists !== null) return this.tableExists;
    try {
      const rows = await this.db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = 'mikrotik_devices'`,
      );
      this.tableExists = Number(rows[0]?.n ?? 0) > 0;
    } catch (error) {
      this.logger.warn(
        `Cek tabel mikrotik_devices gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.tableExists = false;
    }
    return this.tableExists;
  }

  // Dipakai setelah migrasi 005 dijalankan tanpa restart aplikasi.
  forgetSchemaCache(): void {
    this.tableExists = null;
  }

  async list(): Promise<MikrotikDeviceRow[]> {
    if (!(await this.hasTable())) return [];
    return this.db.query<MikrotikDeviceRow>(
      `SELECT ${MIKROTIK_DEVICE_SELECT} FROM mikrotik_devices ORDER BY is_active DESC, name ASC`,
    );
  }

  async find(id: number): Promise<MikrotikDeviceRow | null> {
    if (!(await this.hasTable())) return null;
    const rows = await this.db.query<MikrotikDeviceRow>(
      `SELECT ${MIKROTIK_DEVICE_SELECT} FROM mikrotik_devices WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByName(name: string, exceptId?: number): Promise<MikrotikDeviceRow | null> {
    if (!(await this.hasTable())) return null;
    const rows = await this.db.query<MikrotikDeviceRow>(
      `SELECT ${MIKROTIK_DEVICE_SELECT} FROM mikrotik_devices WHERE name = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`,
      exceptId ? [name, exceptId] : [name],
    );
    return rows[0] ?? null;
  }

  // Perangkat default untuk endpoint yang tidak menyebut id perangkat.
  async firstActive(): Promise<MikrotikDeviceRow | null> {
    if (!(await this.hasTable())) return null;
    const rows = await this.db.query<MikrotikDeviceRow>(
      `SELECT ${MIKROTIK_DEVICE_SELECT} FROM mikrotik_devices WHERE is_active = 1 ORDER BY id ASC LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  async create(data: DeviceWriteData): Promise<number> {
    const result = await this.db.execute(
      `INSERT INTO mikrotik_devices
         (name, host, api_port, api_user, api_password, gui_url, description, write_enabled, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.host,
        data.api_port,
        data.api_user,
        data.api_password ?? '',
        data.gui_url ?? null,
        data.description ?? null,
        data.write_enabled ? 1 : 0,
        data.is_active === false ? 0 : 1,
      ],
    );
    return Number(result.insertId);
  }

  async update(id: number, data: Partial<DeviceWriteData>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      sets.push(`\`${column}\` = ?`);
      params.push(value);
    };

    if (data.name !== undefined) push('name', data.name);
    if (data.host !== undefined) push('host', data.host);
    if (data.api_port !== undefined) push('api_port', data.api_port);
    if (data.api_user !== undefined) push('api_user', data.api_user);
    if (data.api_password !== undefined) push('api_password', data.api_password);
    if (data.gui_url !== undefined) push('gui_url', data.gui_url);
    if (data.description !== undefined) push('description', data.description);
    if (data.write_enabled !== undefined) push('write_enabled', data.write_enabled ? 1 : 0);
    if (data.is_active !== undefined) push('is_active', data.is_active ? 1 : 0);

    if (sets.length === 0) return;
    params.push(id);
    await this.db.execute(`UPDATE mikrotik_devices SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async remove(id: number): Promise<void> {
    await this.db.execute('DELETE FROM mikrotik_devices WHERE id = ?', [id]);
  }

  // Hasil uji koneksi disimpan supaya daftar perangkat menampilkan status
  // terakhir tanpa harus menghubungi semua router setiap kali halaman dibuka.
  async touchStatus(
    id: number,
    result: { connected: boolean; message: string | null; identity: string | null },
  ): Promise<void> {
    if (!(await this.hasTable())) return;
    await this.db.execute(
      `UPDATE mikrotik_devices
          SET last_checked_at = NOW(), last_connected = ?, last_message = ?, last_identity = ?
        WHERE id = ?`,
      [result.connected ? 1 : 0, (result.message ?? '').slice(0, 255) || null, result.identity, id],
    );
  }
}
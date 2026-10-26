import { Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';

interface ConfigRow extends RowDataPacket {
  config_key: string;
  config_value: string;
}

// Tabel `config` adalah penyimpanan key/value yang sudah ada sejak skema awal
// (dipakai juga oleh kredensial MikroTik), jadi tidak perlu tabel baru.
@Injectable()
export class SettingsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findValues(): Promise<Record<string, string>> {
    const rows = await this.db.query<ConfigRow>('SELECT config_key, config_value FROM config');
    return Object.fromEntries(rows.map((row) => [row.config_key, row.config_value]));
  }

  async upsert(values: Record<string, string>): Promise<void> {
    const entries = Object.entries(values);
    if (entries.length === 0) return;

    await this.db.withTransaction(async (conn: PoolConnection) => {
      for (const [key, value] of entries) {
        await conn.query(
          `INSERT INTO config (config_key, config_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
          [key, value],
        );
      }
    });
  }
}

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

  /**
   * Keadaan penomoran Nomor Internet: nomor tertinggi yang sudah terbit dan
   * urutan terakhir di penghitung.
   *
   * Dipakai untuk menolak angka awal yang akan membuat nomor berikutnya
   * menabrak nomor yang sudah terbit. Penghitung sendiri TIDAK pernah diubah
   * di sini — nomor yang sudah keluar tidak boleh dipakai ulang.
   */
  async internetNoState(): Promise<{ maxIssued: number; lastSeq: number }> {
    const row = await this.db.queryOne<{ max_issued: number | null; last_seq: number | null }>(
      `SELECT
         (SELECT MAX(CAST(internet_no AS UNSIGNED)) FROM customers
           WHERE internet_no IS NOT NULL) AS max_issued,
         (SELECT COALESCE(MAX(seq), 0) FROM internet_no_sequence) AS last_seq`,
    );
    return { maxIssued: Number(row?.max_issued ?? 0), lastSeq: Number(row?.last_seq ?? 0) };
  }
}

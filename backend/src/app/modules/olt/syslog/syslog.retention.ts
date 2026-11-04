import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { OltRepository } from '../olt.repository';

/**
 * Retensi otomatis log ONU.
 *
 * Kebijakan disimpan di tabel `config` (key `olt_syslog_retention`) sebagai JSON:
 *   { "mode": "age", "days": 30 }      hapus log lebih tua dari N hari
 *   { "mode": "per_olt", "count": 500 } pertahankan N log terbaru per OLT
 *
 * Diberlakukan berkala lewat `setInterval` (default tiap jam, bisa diubah lewat
 * `SYSLOG_RETENTION_MS`); tanpa framework penjadwal baru. `enforce()` aman
 * dipanggil ulang (DELETE idempoten), dan memakai flag `busy` agar tidak tumpang
 * tindih dengan putaran sebelumnya.
 */

export interface RetentionPolicy {
  mode: 'age' | 'per_olt';
  days?: number;
  count?: number;
}

const RETENTION_KEY = 'olt_syslog_retention';
const DEFAULT_POLICY: RetentionPolicy = { mode: 'age', days: 30 };
const INTERVAL_MS = Number(process.env.SYSLOG_RETENTION_MS) || 3_600_000;

export function normalizeRetentionPolicy(input: Partial<RetentionPolicy>): RetentionPolicy {
  if (input.mode === 'per_olt') {
    const count = Math.min(Math.max(Math.trunc(input.count ?? 500), 1), 100_000);
    return { mode: 'per_olt', count };
  }
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 365);
  return { mode: 'age', days };
}

@Injectable()
export class SyslogRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyslogRetentionService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: OltRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.enforce().catch((error) =>
        this.logger.warn(`Retensi log ONU gagal: ${error instanceof Error ? error.message : String(error)}`),
      );
    }, INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async getPolicy(): Promise<RetentionPolicy> {
    const row = await this.db.queryOne<{ config_value: string }>(
      'SELECT config_value FROM config WHERE config_key = ?',
      [RETENTION_KEY],
    );
    if (!row?.config_value) return { ...DEFAULT_POLICY };
    try {
      return normalizeRetentionPolicy(JSON.parse(row.config_value) as Partial<RetentionPolicy>);
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }

  async setPolicy(policy: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
    const normalized = normalizeRetentionPolicy(policy);
    await this.db.execute(
      `INSERT INTO config (config_key, config_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
      [RETENTION_KEY, JSON.stringify(normalized)],
    );
    return normalized;
  }

  /** Jalankan sekali sekarang; mengembalikan jumlah baris yang dihapus. */
  async enforce(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const policy = await this.getPolicy();
      const removed = await this.repository.enforceSyslogRetention(policy);
      if (removed > 0) {
        this.logger.log(`Retensi log ONU (${policy.mode}): ${removed} baris dihapus`);
      }
      return removed;
    } finally {
      this.busy = false;
    }
  }
}
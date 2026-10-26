import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { probeCoa } from './coa-probe';

/**
 * Penegak batas akun.
 *
 * Atribut RADIUS hanya membatasi SATU sesi: `Session-Timeout` dan
 * `Mikrotik-Total-Limit` dihitung router per sesi. Voucher "5 jam" yang dipakai
 * tiga kali masing-masing 2 jam tetap lolos. Karena itu total lintas sesi harus
 * dijumlahkan dari `radacct`, lalu akun dicabut + sesi diputus lewat CoA.
 *
 * Dijalankan berkala dari proses ini (tanpa dependensi scheduler tambahan).
 */
export interface EnforcementReport {
  checked: number;
  activated: number;
  expired: number;
  disconnected: number;
  errors: string[];
}

interface AccountRow {
  id: number;
  username: string;
  user_type: string;
  status: string;
  profile_type: 'hotspot' | 'ppp';
  first_login_at: string | null;
  expires_at: string | null;
  validity_value: number | null;
  validity_unit: string | null;
  timebase_value: number | null;
  timebase_unit: string | null;
  quotabase_value: number | null;
  quotabase_unit: string | null;
  online_seconds: number | string | null;
  quota_used_bytes: number | string | null;
}

interface UsageRow {
  username: string;
  seconds: number | string;
  octets: number | string;
  open_sessions: number | string;
  nas: string | null;
}

const UNIT_SECONDS: Record<string, number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
  month: 2592000,
};

const UNIT_BYTES: Record<string, number> = {
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

@Injectable()
export class RadiusEnforcementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RadiusEnforcementService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  /** Interval pemeriksaan; 0 mematikan penegakan otomatis. */
  private readonly intervalMs = Number(process.env.RADIUS_ENFORCE_INTERVAL_MS ?? 60_000);

  constructor(private readonly db: DatabaseService) {}

  onModuleInit() {
    if (!this.intervalMs || this.intervalMs < 10_000) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const report = await this.enforce();
      if (report.expired > 0 || report.errors.length > 0) {
        this.logger.log(
          `Penegakan: ${report.checked} akun, ${report.expired} kedaluwarsa, ` +
            `${report.disconnected} sesi diputus` +
            (report.errors.length ? `, ${report.errors.length} galat` : ''),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Penegakan gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Satu putaran penegakan. Aman dipanggil manual dari endpoint. */
  async enforce(): Promise<EnforcementReport> {
    const report: EnforcementReport = {
      checked: 0,
      activated: 0,
      expired: 0,
      disconnected: 0,
      errors: [],
    };

    const accounts = await this.db.query<AccountRow>(`
      SELECT v.id, v.username, v.user_type, v.status, v.profile_type,
             v.first_login_at, v.expires_at, v.online_seconds, v.quota_used_bytes,
             h.validity_value, h.validity_unit, h.timebase_value, h.timebase_unit,
             h.quotabase_value, h.quotabase_unit
        FROM radius_vouchers v
        LEFT JOIN hotspot_profiles h ON v.profile_type = 'hotspot' AND h.id = v.profile_id
        LEFT JOIN ppp_profiles p     ON v.profile_type = 'ppp'     AND p.id = v.profile_id
       WHERE v.status IN ('ready-to-use','active','new-created')
    `);

    if (accounts.length === 0) return report;

    const placeholders = accounts.map(() => '?').join(',');
    const usage = await this.db.query<UsageRow>(
      `SELECT a.username,
              SUM(COALESCE(a.acctsessiontime, TIMESTAMPDIFF(SECOND, a.acctstarttime, NOW()))) AS seconds,
              SUM(COALESCE(a.acctinputoctets,0) + COALESCE(a.acctoutputoctets,0)) AS octets,
              SUM(a.acctstoptime IS NULL) AS open_sessions,
              MAX(CASE WHEN a.acctstoptime IS NULL THEN a.nasipaddress END) AS nas
         FROM radacct a
        WHERE a.username IN (${placeholders})
        GROUP BY a.username`,
      accounts.map((a) => a.username),
    );

    const byUser = new Map(usage.map((row) => [row.username, row]));

    for (const account of accounts) {
      report.checked += 1;
      const used = byUser.get(account.username);
      const seconds = Number(used?.seconds ?? 0);
      const octets = Number(used?.octets ?? 0);
      const openSessions = Number(used?.open_sessions ?? 0);

      // Login pertama tercatat di radacct walau akun masih 'ready-to-use':
      // masa aktif mulai dihitung dari sini, bukan dari tanggal dibuat.
      if (!account.first_login_at && seconds > 0) {
        await this.activate(account);
        report.activated += 1;
        account.first_login_at = new Date().toISOString();
      }

      await this.db.execute(
        'UPDATE radius_vouchers SET online_seconds = ?, quota_used_bytes = ? WHERE id = ?',
        [seconds, octets, account.id],
      );

      const limitSeconds = this.timeLimit(account);
      const limitBytes = this.quotaLimit(account);
      const pastExpiry =
        account.expires_at !== null && new Date(account.expires_at).getTime() <= Date.now();
      const overTime = limitSeconds !== null && seconds >= limitSeconds;
      const overQuota = limitBytes !== null && octets >= limitBytes;

      if (!pastExpiry && !overTime && !overQuota) continue;

      const reason = pastExpiry ? 'masa aktif habis' : overTime ? 'batas waktu habis' : 'kuota habis';
      try {
        await this.expire(account, reason);
        report.expired += 1;
        if (openSessions > 0 && used?.nas) {
          const sent = await this.disconnect(used.nas, account.username);
          if (sent) report.disconnected += 1;
        }
      } catch (error) {
        report.errors.push(
          `${account.username}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return report;
  }

  private timeLimit(account: AccountRow): number | null {
    const value = Number(account.timebase_value ?? 0);
    const unit = account.timebase_unit ?? '';
    if (!value || !unit || !UNIT_SECONDS[unit]) return null;
    return value * UNIT_SECONDS[unit];
  }

  private quotaLimit(account: AccountRow): number | null {
    const value = Number(account.quotabase_value ?? 0);
    const unit = account.quotabase_unit ?? '';
    if (!value || !unit || !UNIT_BYTES[unit]) return null;
    return value * UNIT_BYTES[unit];
  }

  private async activate(account: AccountRow) {
    const value = Number(account.validity_value ?? 0);
    const unit = account.validity_unit ?? '';
    const seconds = value > 0 && UNIT_SECONDS[unit] ? value * UNIT_SECONDS[unit] : 0;
    await this.db.execute(
      `UPDATE radius_vouchers
          SET status = 'active', first_login_at = NOW(), expires_at = ?
        WHERE id = ?`,
      [seconds > 0 ? new Date(Date.now() + seconds * 1000) : null, account.id],
    );
    // audit_logs.user_id NOT NULL, dan tindakan ini tidak punya aktor manusia.
    // Dicatat di log proses saja supaya tidak mengarang user_id.
    this.logger.log(`Aktivasi otomatis ${account.username} (masa aktif ${seconds} detik)`);
  }

  /** Mencabut akun dari RADIUS: itu yang benar-benar menolak login berikutnya. */
  private async expire(account: AccountRow, reason: string) {
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radcheck WHERE username = ?', [account.username]);
      await connection.query('DELETE FROM radreply WHERE username = ?', [account.username]);
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [account.username]);
      await connection.query(
        "UPDATE radius_vouchers SET status = 'expired' WHERE id = ?",
        [account.id],
      );
    });
    this.logger.log(`Kedaluwarsa otomatis ${account.username}: ${reason}`);
  }

  /** CoA Disconnect ke NAS pemilik sesi, memakai secret dari tabel `nas`. */
  private async disconnect(nasAddress: string, username: string): Promise<boolean> {
    const rows = await this.db.query<{ secret: string }>(
      'SELECT secret FROM nas WHERE nasname = ? LIMIT 1',
      [nasAddress],
    );
    if (!rows[0]?.secret) return false;
    const result = await probeCoa({
      host: nasAddress,
      port: 3799,
      secret: rows[0].secret,
      username,
      timeoutMs: 3000,
    });
    return result.reachable;
  }
}

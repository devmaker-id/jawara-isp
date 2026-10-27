import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { probeCoa } from './coa-probe';
import { IsolirService } from './isolir.service';

/**
 * Penegak batas akun — TOTAL kumulatif, bukan per sesi.
 *
 * `Session-Timeout` dan `Mikrotik-Total-Limit` dihitung router per sesi, jadi
 * voucher "6 jam" yang dipakai tiga kali @2 jam tetap lolos. Karena itu total
 * lintas sesi dijumlahkan dari `radacct`, lalu:
 *
 *   - Hotspot : akun ditolak dengan `Reply-Message` yang menjelaskan sebabnya
 *               ("Waktu online habis" / "Kuota habis" / "User expired").
 *   - PPPoE   : grup RADIUS dipindah ke ISOLIR (IP 10.127.0.0/18), sesi diputus
 *               lewat CoA sehingga klien masuk ulang sebagai pelanggan isolir.
 *
 * Masa aktif dihitung dari LOGIN PERTAMA, bukan tanggal dibuat. Saat login
 * pertama terdeteksi, `Expiration` ditulis ke radcheck agar FreeRADIUS sendiri
 * menolak walau proses ini sedang mati.
 */
export interface EnforcementReport {
  checked: number;
  activated: number;
  blocked_hotspot: number;
  isolated_ppp: number;
  disconnected: number;
  errors: string[];
}

interface AccountRow extends RowDataPacket {
  id: number;
  username: string;
  password: string;
  user_type: string;
  status: string;
  profile_type: 'hotspot' | 'ppp';
  first_login_at: string | null;
  expires_at: string | null;
  block_reason: string | null;
  // Batas dari GRUP (profil layanan), bukan dari akun.
  validity_value: number | null;
  validity_unit: string | null;
  hotspot_seconds: number | null;
  hotspot_bytes: number | null;
  ppp_seconds: number | null;
  ppp_bytes: number | null;
}

interface UsageRow extends RowDataPacket {
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

// Basis 1000: sama dengan cara ISP menjual kuota dan sama dengan panel.
const UNIT_BYTES: Record<string, number> = {
  MB: 1_000_000,
  GB: 1_000_000_000,
};

/** Pesan yang muncul di halaman login hotspot (Reply-Message pada Access-Reject). */
export const BLOCK_MESSAGE: Record<string, string> = {
  time: 'Waktu online habis',
  quota: 'Kuota habis',
  validity: 'User expired',
};

/** Format tanggal FreeRADIUS: "26 Okt 2026 15:04:05". */
export function freeRadiusDate(date: Date): string {
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${two(date.getDate())} ${bulan[date.getMonth()]} ${date.getFullYear()} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

/** Batas waktu total (detik) dari profil grup; null = tanpa batas. */
export function totalTimeLimit(account: {
  profile_type: string;
  hotspot_seconds?: number | null;
  ppp_seconds?: number | null;
}): number | null {
  const value = account.profile_type === 'hotspot' ? account.hotspot_seconds : account.ppp_seconds;
  const seconds = Number(value ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Batas kuota total (byte) dari profil grup; null = tanpa batas. */
export function totalQuotaLimit(account: {
  profile_type: string;
  hotspot_bytes?: number | null;
  ppp_bytes?: number | null;
}): number | null {
  const value = account.profile_type === 'hotspot' ? account.hotspot_bytes : account.ppp_bytes;
  const bytes = Number(value ?? 0);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

@Injectable()
export class RadiusEnforcementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RadiusEnforcementService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  /** Interval pemeriksaan; 0 mematikan penegakan otomatis. */
  private readonly intervalMs = Number(process.env.RADIUS_ENFORCE_INTERVAL_MS ?? 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly isolir: IsolirService,
  ) {}

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
      const changed =
        report.blocked_hotspot + report.isolated_ppp + report.activated > 0;
      if (changed || report.errors.length > 0) {
        this.logger.log(
          `Penegakan: ${report.checked} akun, ${report.activated} aktivasi, ` +
            `${report.blocked_hotspot} blokir hotspot, ${report.isolated_ppp} isolir, ` +
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
      blocked_hotspot: 0,
      isolated_ppp: 0,
      disconnected: 0,
      errors: [],
    };

    const accounts = await this.db.query<AccountRow>(`
      SELECT v.id, v.username, v.password, v.user_type, v.status, v.profile_type,
             v.first_login_at, v.expires_at, v.block_reason,
             COALESCE(h.validity_value, p.validity_value) AS validity_value,
             COALESCE(h.validity_unit,  p.validity_unit)  AS validity_unit,
             h.timebase_value * CASE h.timebase_unit
               WHEN 'minute' THEN 60 WHEN 'hour' THEN 3600
               WHEN 'day' THEN 86400 WHEN 'month' THEN 2592000 ELSE 0 END AS hotspot_seconds,
             h.quotabase_value * CASE h.quotabase_unit
               WHEN 'MB' THEN 1000000 WHEN 'GB' THEN 1000000000 ELSE 0 END AS hotspot_bytes,
             p.time_limit_seconds AS ppp_seconds,
             p.quota_limit_bytes  AS ppp_bytes
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

      const limitSeconds = totalTimeLimit(account);
      const limitBytes = totalQuotaLimit(account);
      const pastExpiry =
        account.expires_at !== null && new Date(account.expires_at).getTime() <= Date.now();
      const overTime = limitSeconds !== null && seconds >= limitSeconds;
      const overQuota = limitBytes !== null && octets >= limitBytes;

      if (!pastExpiry && !overTime && !overQuota) continue;

      // Urutan sebab menentukan pesan: masa aktif lebih dulu karena itu yang
      // paling tidak bisa diperbaiki pelanggan sendiri.
      const reason = pastExpiry ? 'validity' : overTime ? 'time' : 'quota';

      try {
        if (account.profile_type === 'ppp') {
          await this.isolir.isolate(account.username, reason);
          report.isolated_ppp += 1;
        } else {
          await this.blockHotspot(account, reason);
          report.blocked_hotspot += 1;
        }
        if (openSessions > 0 && used?.nas) {
          const sent = await this.disconnect(String(used.nas), account.username);
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

  /**
   * Login pertama: mulai masa aktif DAN tulis `Expiration` ke radcheck.
   *
   * `Expiration` membuat FreeRADIUS menolak sendiri setelah masa aktif habis,
   * sehingga penegakan tidak bergantung pada proses ini tetap hidup.
   */
  private async activate(account: AccountRow) {
    const value = Number(account.validity_value ?? 0);
    const unit = account.validity_unit ?? '';
    const seconds = value > 0 && UNIT_SECONDS[unit] ? value * UNIT_SECONDS[unit] : 0;
    const expiresAt = seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;

    await this.db.execute(
      `UPDATE radius_vouchers
          SET status = 'active', first_login_at = NOW(), expires_at = ?
        WHERE id = ?`,
      [expiresAt, account.id],
    );

    if (expiresAt) {
      await this.db.execute(
        'DELETE FROM radcheck WHERE username = ? AND attribute = ?',
        [account.username, 'Expiration'],
      );
      await this.db.execute(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        [account.username, 'Expiration', ':=', freeRadiusDate(expiresAt)],
      );
    }

    // audit_logs.user_id NOT NULL, dan tindakan ini tidak punya aktor manusia.
    this.logger.log(`Aktivasi otomatis ${account.username} (masa aktif ${seconds} detik)`);
  }

  /**
   * Blokir hotspot: tolak login TAPI sertakan alasannya.
   *
   * Akun tidak dihapus — password dan grup tetap ada supaya bisa diaktifkan
   * kembali, dan `Reply-Message` yang tampil di halaman login memberi tahu
   * pelanggan apa yang terjadi.
   */
  private async blockHotspot(account: AccountRow, reason: string) {
    const message = BLOCK_MESSAGE[reason] ?? 'Akun tidak dapat digunakan';

    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radcheck WHERE username = ?', [account.username]);
      await connection.query('DELETE FROM radreply WHERE username = ?', [account.username]);

      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value)
         VALUES (?, 'Cleartext-Password', ':=', ?)`,
        [account.username, account.password],
      );
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value)
         VALUES (?, 'Auth-Type', ':=', 'Reject')`,
        [account.username],
      );
      await connection.query(
        `INSERT INTO radreply (username, attribute, op, value)
         VALUES (?, 'Reply-Message', ':=', ?)`,
        [account.username, message],
      );
      await connection.query(
        `UPDATE radius_vouchers
            SET status = 'expired', block_reason = ?
          WHERE id = ?`,
        [reason, account.id],
      );
    });
    this.logger.log(`Blokir hotspot ${account.username}: ${message}`);
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

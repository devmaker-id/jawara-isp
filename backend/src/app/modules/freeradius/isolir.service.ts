import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';

/**
 * Profil ISOLIR untuk PPPoE.
 *
 * Pelanggan yang kehabisan batas waktu/kuota — atau menunggak — dipindahkan
 * grup RADIUS-nya ke ISOLIR. Ia tetap bisa login (password tidak dicabut),
 * tetapi mendapat alamat dari 10.127.0.0/18 dan rate limit kecil, sehingga
 * hanya halaman isolir yang bisa dibuka.
 *
 * Yang dikerjakan modul ini:
 *   1. Menyimpan konfigurasi isolir di tabel `config` (bisa diubah dari panel).
 *   2. Menulis atribut grup ISOLIR ke `radgroupreply` (berlaku untuk semua user
 *      yang dipindahkan ke grup itu).
 *   3. Menyiapkan /ip/pool + /ppp/profile di perangkat lewat API.
 *   4. Memindahkan & mengembalikan user antar grup.
 *
 * Firewall/redirect TIDAK dijalankan otomatis: itu menyentuh jalur produksi.
 * Perintahnya dihasilkan sebagai teks untuk diperiksa operator.
 */

export const ISOLIR_KEYS = [
  'isolir_enabled',
  'isolir_group',
  'isolir_pool_name',
  'isolir_cidr',
  'isolir_gateway',
  'isolir_range_start',
  'isolir_range_end',
  'isolir_rate_limit',
  'isolir_url',
  'isolir_message',
] as const;

export type IsolirKey = (typeof ISOLIR_KEYS)[number];

export interface IsolirConfig {
  enabled: boolean;
  group: string;
  pool_name: string;
  cidr: string;
  gateway: string;
  range_start: string;
  range_end: string;
  rate_limit: string;
  /** URL halaman isolir; dikosongkan = fitur redirect belum dikonfigurasi. */
  url: string;
  message: string;
}

const DEFAULTS: IsolirConfig = {
  enabled: true,
  group: 'ISOLIR',
  pool_name: 'ISOLIR-POOL',
  cidr: '10.127.0.0/18',
  gateway: '10.127.0.1',
  range_start: '10.127.0.2',
  range_end: '10.127.63.254',
  rate_limit: '512k/512k',
  url: '',
  message:
    'Tagihan belum dibayar atau masa aktif habis. Silakan buka halaman isolir untuk melanjutkan.',
};

/** IPv4 bertitik → bilangan bulat; null bila tidak valid. */
export function ipToInt(value: string): number | null {
  const parts = (value ?? '').trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

/** 10.127.0.0/18 → batas bawah & atas dalam bilangan bulat. */
export function cidrRange(cidr: string): { first: number; last: number } | null {
  const [base, bitsRaw] = (cidr ?? '').split('/');
  const bits = Number(bitsRaw);
  const ip = ipToInt(base ?? '');
  if (ip === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const first = (ip & mask) >>> 0;
  const last = (first | (~mask >>> 0)) >>> 0;
  return { first, last };
}

@Injectable()
export class IsolirService {
  private readonly logger = new Logger(IsolirService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mikrotik: MikrotikService,
  ) {}

  // ---------------------------------------------------------------------------
  // Konfigurasi
  // ---------------------------------------------------------------------------
  async getConfig(): Promise<IsolirConfig> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT config_key, config_value FROM config WHERE config_key LIKE 'isolir\\_%'`,
    );
    const stored = new Map(rows.map((row) => [String(row.config_key), String(row.config_value ?? '')]));
    const pick = (key: IsolirKey, fallback: string) => {
      const value = stored.get(key);
      return value === undefined || value === '' ? fallback : value;
    };
    return {
      enabled: pick('isolir_enabled', '1') === '1',
      group: pick('isolir_group', DEFAULTS.group),
      pool_name: pick('isolir_pool_name', DEFAULTS.pool_name),
      cidr: pick('isolir_cidr', DEFAULTS.cidr),
      gateway: pick('isolir_gateway', DEFAULTS.gateway),
      range_start: pick('isolir_range_start', DEFAULTS.range_start),
      range_end: pick('isolir_range_end', DEFAULTS.range_end),
      rate_limit: pick('isolir_rate_limit', DEFAULTS.rate_limit),
      // URL memang boleh kosong: itu penanda redirect belum disiapkan.
      url: stored.get('isolir_url') ?? '',
      message: pick('isolir_message', DEFAULTS.message),
    };
  }

  async saveConfig(input: Partial<IsolirConfig>): Promise<IsolirConfig> {
    const current = await this.getConfig();
    const next: IsolirConfig = {
      ...current,
      ...Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ),
    } as IsolirConfig;

    this.validate(next);

    const rows: Array<[string, string]> = [
      ['isolir_enabled', next.enabled ? '1' : '0'],
      ['isolir_group', next.group],
      ['isolir_pool_name', next.pool_name],
      ['isolir_cidr', next.cidr],
      ['isolir_gateway', next.gateway],
      ['isolir_range_start', next.range_start],
      ['isolir_range_end', next.range_end],
      ['isolir_rate_limit', next.rate_limit],
      ['isolir_url', next.url],
      ['isolir_message', next.message],
    ];
    for (const [key, value] of rows) {
      await this.db.execute(
        `INSERT INTO config (config_key, config_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [key, value],
      );
    }
    return this.getConfig();
  }

  private validate(config: IsolirConfig) {
    if (!config.group.trim()) throw new BadRequestException('Nama grup isolir wajib diisi.');
    if (!config.pool_name.trim()) throw new BadRequestException('Nama IP pool isolir wajib diisi.');

    const range = cidrRange(config.cidr);
    if (!range) throw new BadRequestException(`CIDR "${config.cidr}" tidak valid.`);

    const start = ipToInt(config.range_start);
    const end = ipToInt(config.range_end);
    const gateway = ipToInt(config.gateway);
    if (start === null || end === null) {
      throw new BadRequestException('IP awal/akhir pool isolir harus IPv4 yang valid.');
    }
    if (start > end) {
      throw new BadRequestException('IP awal pool isolir harus lebih kecil dari IP akhir.');
    }
    if (gateway === null) throw new BadRequestException('Gateway isolir harus IPv4 yang valid.');

    // Gateway tidak boleh berada di dalam rentang pool: alamat itu dipakai
    // perangkat, bukan dibagikan ke pelanggan.
    if (gateway >= start && gateway <= end) {
      throw new BadRequestException(
        `Gateway ${config.gateway} berada di dalam rentang pool isolir. Pindahkan ke luar rentang.`,
      );
    }
    if (start < range.first || end > range.last) {
      throw new BadRequestException(
        `Rentang pool ${config.range_start}-${config.range_end} keluar dari CIDR ${config.cidr}.`,
      );
    }
    if (config.url.trim() && !/^https?:\/\//i.test(config.url.trim())) {
      throw new BadRequestException('URL halaman isolir harus diawali http:// atau https://');
    }
  }

  // ---------------------------------------------------------------------------
  // Atribut grup RADIUS
  // ---------------------------------------------------------------------------
  /**
   * Menulis atribut grup ISOLIR ke radgroupreply.
   *
   * `Framed-Pool` menunjuk pool di router; `Mikrotik-Rate-Limit` membuat
   * koneksi isolir tidak bisa dipakai mengunduh besar-besaran; DNS tetap
   * dikirim supaya halaman isolir (kalau dihosting di luar) bisa dibuka.
   */
  async syncGroupAttributes(): Promise<{ group: string; attributes: number }> {
    const config = await this.getConfig();
    const rows: Array<[string, string, string]> = [
      ['Framed-Pool', ':=', config.pool_name],
      ['Mikrotik-Rate-Limit', ':=', config.rate_limit],
      ['MS-Primary-DNS-Server', ':=', '1.1.1.1'],
      ['MS-Secondary-DNS-Server', ':=', '8.8.8.8'],
    ];

    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radgroupreply WHERE groupname = ?', [config.group]);
      await connection.query('DELETE FROM radgroupcheck WHERE groupname = ?', [config.group]);
      for (const [attribute, op, value] of rows) {
        await connection.query(
          'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [config.group, attribute, op, value],
        );
      }
    });
    return { group: config.group, attributes: rows.length };
  }

  // ---------------------------------------------------------------------------
  // Penyiapan perangkat
  // ---------------------------------------------------------------------------
  /**
   * Menyiapkan pool + profil PPP isolir di satu perangkat.
   *
   * Profil lokal hanya membawa `local-address` dan `remote-address`; rate limit
   * datang dari RADIUS supaya angkanya satu sumber.
   */
  async provisionDevice(deviceId: number) {
    const config = await this.getConfig();
    const result = await this.mikrotik.provisionGroupProfile({
      deviceId,
      type: 'ppp',
      name: config.group,
      poolName: config.pool_name,
      createPool: {
        name: config.pool_name,
        rangeStart: config.range_start,
        rangeEnd: config.range_end,
      },
      localAddress: config.gateway,
      dnsPrimary: '1.1.1.1',
      dnsSecondary: '8.8.8.8',
      parentQueue: null,
    });
    this.logger.log(
      `Isolir di perangkat #${deviceId}: ${result.action} — ${result.message}`,
    );
    return result;
  }

  /** Grup isolir di tabel panel, supaya terlihat di Layanan → Group Profile. */
  async ensureGroupRow(deviceId: number): Promise<number | null> {
    const config = await this.getConfig();
    const existing = await this.db.queryOne<RowDataPacket>(
      `SELECT id FROM group_profiles WHERE type = 'ppp' AND name = ? LIMIT 1`,
      [config.group],
    );
    if (existing) return Number(existing.id);

    try {
      const result = await this.db.execute(
        `INSERT INTO group_profiles
           (owner_id, router_id, name, type, pool_mode, mikrotik_pool_name,
            pool_local_address, pool_range_start, pool_range_end, pool_created,
            dns_primary, dns_secondary, parent_queue, use_router_default)
         VALUES (NULL, ?, ?, 'ppp', 'router-pool', ?, ?, ?, ?, 1, '1.1.1.1', '8.8.8.8', NULL, 0)`,
        [
          deviceId,
          config.group,
          config.pool_name,
          config.gateway,
          config.range_start,
          config.range_end,
        ],
      );
      return result.insertId;
    } catch (error) {
      // UNIQUE(owner_id,type,name) dengan owner NULL tidak menahan duplikat di
      // MariaDB, jadi kegagalan di sini berarti masalah lain — jangan ditelan.
      this.logger.warn(`Gagal membuat baris grup isolir: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Perintah MikroTik untuk memutus internet pelanggan isolir dan
   * mengarahkannya ke halaman isolir.
   *
   * Dihasilkan sebagai teks, tidak dijalankan: aturan firewall menyentuh jalur
   * produksi dan harus diperiksa operator.
   */
  async deviceCommands(): Promise<{ url: string; commands: Array<{ command: string; note: string }> }> {
    const config = await this.getConfig();
    const host = (() => {
      try {
        return new URL(config.url).host;
      } catch {
        return '';
      }
    })();

    const commands = [
      {
        command: `/ip pool add name=${config.pool_name} ranges=${config.range_start}-${config.range_end}`,
        note: 'Pool alamat isolir. Dibuat panel otomatis saat profil isolir disiapkan.',
      },
      {
        command:
          `/ppp profile add name=${config.group} local-address=${config.gateway} ` +
          `remote-address=${config.pool_name} dns-server=1.1.1.1,8.8.8.8`,
        note: 'Profil lokal PPP; rate limit tetap datang dari RADIUS (radgroupreply).',
      },
      {
        command:
          `/ip firewall address-list add list=ISOLIR address=${config.cidr} comment="jawara-isp isolir"`,
        note: 'Daftar alamat pelanggan isolir.',
      },
      {
        command:
          `/ip firewall filter add chain=forward src-address-list=ISOLIR ` +
          `action=drop comment="jawara-isp: isolir tanpa internet" place-before=0`,
        note:
          'Mematikan akses internet pelanggan isolir. WAJIB diuji: pasang setelah aturan ' +
          'yang mengizinkan halaman isolir, kalau tidak halaman itu ikut terblokir.',
      },
      {
        command: host
          ? `/ip firewall address-list add list=ISOLIR-ALLOW address=${host} comment="halaman isolir"`
          : '# isi URL halaman isolir di panel, lalu jalankan ulang untuk perintah yang benar',
        note: 'Host halaman isolir harus tetap bisa dijangkau dari pelanggan isolir.',
      },
      {
        command:
          `/ip firewall nat add chain=dstnat src-address-list=ISOLIR protocol=tcp ` +
          `dst-port=80 action=dst-nat to-addresses=${config.gateway} to-ports=80 ` +
          `comment="jawara-isp: redirect halaman isolir"`,
        note:
          'Redirect HTTP ke halaman isolir. Ganti to-addresses ke server halaman isolir bila ' +
          'halaman tidak dihosting di router.',
      },
      {
        command:
          `/ip firewall nat add chain=dstnat src-address-list=ISOLIR protocol=tcp ` +
          `dst-port=443 action=reject reject-with=tcp-reset ` +
          `comment="jawara-isp: blokir HTTPS isolir"`,
        note: 'HTTPS tidak bisa di-redirect tanpa sertifikat; lebih jujur ditolak.',
      },
    ];
    return { url: config.url, commands };
  }

  // ---------------------------------------------------------------------------
  // Memindahkan user
  // ---------------------------------------------------------------------------
  /**
   * Memindahkan satu akun ke grup isolir.
   *
   * Password TIDAK dicabut: pelanggan harus tetap bisa login supaya mendapat
   * alamat isolir. Yang berubah hanya grupnya.
   */
  async isolate(username: string, reason: string): Promise<{ username: string; group: string }> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new BadRequestException('Profil isolir sedang dinonaktifkan di pengaturan.');
    }

    const account = await this.db.queryOne<RowDataPacket>(
      `SELECT id, profile_type, profile_id, username FROM radius_vouchers WHERE username = ?`,
      [username],
    );
    if (!account) throw new BadRequestException(`Akun "${username}" tidak ditemukan.`);
    if (String(account.profile_type) !== 'ppp') {
      throw new BadRequestException(
        `Isolir hanya untuk akun PPPoE. Akun "${username}" bertipe ${account.profile_type}; ` +
          'untuk hotspot cukup blokir lewat status pelanggan.',
      );
    }

    // Atribut grup harus ada sebelum user dipindah, kalau tidak ia login tanpa
    // pool dan tetap mendapat alamat normal.
    await this.syncGroupAttributes();

    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
      await connection.query(
        'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
        [username, config.group],
      );
      await connection.query(
        `UPDATE radius_vouchers
            SET status = 'expired', block_reason = ?, isolir_at = NOW()
          WHERE username = ?`,
        [reason.slice(0, 16), username],
      );
    });

    this.logger.log(`Akun ${username} dipindah ke isolir (${reason}).`);
    return { username, group: config.group };
  }

  /** Mengembalikan akun ke grup profil aslinya (mis. setelah tagihan dibayar). */
  async release(username: string): Promise<{ username: string; group: string }> {
    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT v.id, v.profile_type, v.profile_id, v.username,
              COALESCE(h.radius_group, h.name, p.radius_group, p.name) AS groupname
         FROM radius_vouchers v
         LEFT JOIN hotspot_profiles h ON v.profile_type = 'hotspot' AND h.id = v.profile_id
         LEFT JOIN ppp_profiles p     ON v.profile_type = 'ppp'     AND p.id = v.profile_id
        WHERE v.username = ?`,
      [username],
    );
    if (!row) throw new BadRequestException(`Akun "${username}" tidak ditemukan.`);
    const groupname = String(row.groupname ?? '');
    if (!groupname) {
      throw new BadRequestException(
        `Profil akun "${username}" tidak ditemukan; grup tujuan tidak bisa ditentukan.`,
      );
    }

    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
      await connection.query(
        'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
        [username, groupname],
      );
      // Blokir waktu/kuota tidak ikut dilepas: kalau pelanggan masih kehabisan
      // batas, penegak akan mengisolasinya lagi pada putaran berikutnya.
      await connection.query(
        `UPDATE radius_vouchers
            SET status = 'active', block_reason = NULL, isolir_at = NULL
          WHERE username = ?`,
        [username],
      );
    });
    return { username, group: groupname };
  }

  /** Ringkasan untuk panel. */
  async status() {
    const config = await this.getConfig();
    const counts = await this.db.queryOne<RowDataPacket>(
      `SELECT COUNT(*) AS total,
              SUM(profile_type = 'ppp') AS ppp,
              SUM(block_reason IS NOT NULL) AS blocked
         FROM radius_vouchers WHERE isolir_at IS NOT NULL`,
    );
    const rows = await this.db.query<RowDataPacket>(
      `SELECT v.username, v.block_reason, v.isolir_at, c.name AS customer_name
         FROM radius_vouchers v
         LEFT JOIN customers c ON c.id = v.customer_id
        WHERE v.isolir_at IS NOT NULL
        ORDER BY v.isolir_at DESC LIMIT 50`,
    );
    const attrs = await this.db.query<RowDataPacket>(
      `SELECT attribute, op, value FROM radgroupreply WHERE groupname = ? ORDER BY attribute`,
      [config.group],
    );
    return {
      config,
      counts: {
        total: Number(counts?.total ?? 0),
        ppp: Number(counts?.ppp ?? 0),
        blocked: Number(counts?.blocked ?? 0),
      },
      accounts: rows.map((row) => ({
        username: String(row.username),
        customer_name: (row.customer_name as string | null) ?? null,
        block_reason: (row.block_reason as string | null) ?? null,
        isolir_at: row.isolir_at as Date,
      })),
      group_attributes: attrs.map((row) => ({
        attribute: String(row.attribute),
        op: String(row.op),
        value: String(row.value),
      })),
      range: cidrRange(config.cidr),
    };
  }
}

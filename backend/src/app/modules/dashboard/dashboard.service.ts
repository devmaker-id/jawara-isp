import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { readServerMetrics, ServerMetrics } from './system-metrics';

// Ringkasan dashboard: metrik host, hitungan sesi online dari perangkat, dan
// angka tagihan. Semua query di sini baca-saja.

export interface DashboardSummary {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
  server: ServerMetrics;
  online: OnlineCounts;
  /** Log autentikasi RADIUS 24 jam terakhir. */
  auth: AuthHealth;
  /** Akun yang masa aktifnya habis / hampir habis. */
  expiring: ExpiringSoon;
  /** Sebaran voucher per profil layanan. */
  vouchers: VoucherProfileRow[];
}

export interface OnlineCounts {
  hotspot: number | null;
  ppp: number | null;
  /** Sesi terbuka yang tidak bisa dipastikan hotspot atau PPP. */
  unclassified: number;
  device: string | null;
  error: string | null;
  /** 'radius' bila angka berasal dari radacct, 'device' bila terpaksa dari API. */
  source: 'radius' | 'device' | null;
}

/** Ringkasan autentikasi RADIUS 24 jam terakhir, dari radpostauth. */
export interface AuthHealth {
  accept: number;
  reject: number;
  total: number;
  /** Persentase ditolak; 0 bila belum ada percobaan. */
  reject_percent: number;
  /**
   * Penolakan atas percobaan berbentuk MAC address — biasanya halaman login
   * hotspot yang mencoba autentikasi perangkat, bukan pelanggan yang salah
   * sandi. Dipisahkan supaya angka penolakan tidak selalu terlihat merah.
   */
  reject_mac: number;
  /** Penolakan dengan username akun sungguhan. */
  reject_account: number;
  /** Username akun yang paling sering ditolak (MAC sudah dibuang). */
  top_rejected: Array<{ username: string; count: number }>;
  error: string | null;
}

/** Akun yang masa aktifnya habis atau hampir habis. */
export interface ExpiringAccount {
  username: string;
  profile_name: string;
  profile_type: 'hotspot' | 'ppp';
  expires_at: string;
  /** Negatif = sudah lewat. */
  days_left: number;
}

export interface ExpiringSoon {
  /** Sudah melewati expires_at tetapi belum sempat ditandai penegak. */
  overdue: number;
  /** Habis dalam 1x24 jam. */
  in_24h: number;
  /** Habis dalam 2-3 hari. */
  in_3d: number;
  /** Akun aktif tanpa masa aktif sama sekali (profil validity 0). */
  without_expiry: number;
  rows: ExpiringAccount[];
  error: string | null;
}

/** Sebaran voucher per profil layanan. */
export interface VoucherProfileRow {
  profile_name: string;
  profile_type: 'hotspot' | 'ppp';
  /** Baru dibuat, belum diserahkan. */
  created: number;
  /** Sudah siap dipakai pelanggan. */
  ready: number;
  /** Sudah terpakai (punya sesi/masa aktif berjalan). */
  used: number;
  expired: number;
  total: number;
}

interface BillingRow {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
}

const EMPTY_BILLING: BillingRow = {
  total_customers: 0,
  active_packages: 0,
  total_invoices: 0,
  unpaid_count: 0,
  unpaid_total: 0,
  today_revenue: 0,
  today_payments: 0,
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);


  constructor(private readonly db: DatabaseService) {}

  async summary(): Promise<DashboardSummary> {
    // Dashboard = wajah layanan RADIUS. Tidak ada satu pun panggilan API
    // perangkat dari sini: monitoring MikroTik hanya di menu MikroTik, supaya
    // koneksi API ke router tidak terus-menerus dibuat oleh halaman yang
    // dibuka sepanjang hari.
    const [billing, server, online, auth, expiring, vouchers] = await Promise.all([
      this.billing(),
      readServerMetrics(),
      this.online(),
      this.authHealth(),
      this.expiringSoon(),
      this.vouchersByProfile(),
    ]);
    return { ...billing, server, online, auth, expiring, vouchers };
  }

  /**
   * Autentikasi RADIUS 24 jam terakhir dari `radpostauth`.
   *
   * Ini indikator paling cepat saat ada masalah: lonjakan Access-Reject berarti
   * akun kedaluwarsa dipakai lagi, sandi salah, atau NAS memakai secret keliru.
   * Tidak butuh tabel baru — FreeRADIUS sudah menulisnya.
   */
  private async authHealth(): Promise<AuthHealth> {
    const empty: AuthHealth = {
      accept: 0,
      reject: 0,
      total: 0,
      reject_percent: 0,
      reject_mac: 0,
      reject_account: 0,
      top_rejected: [],
      error: null,
    };
    try {
      // MAC dikenali dari polanya (aa:bb:cc:dd:ee:ff atau aa-bb-...), bukan dari
      // daftar perangkat: halaman login hotspot memang mencoba username MAC.
      const MAC = "username REGEXP '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$'";
      const row = await this.db.queryOne<{
        accept: number;
        reject: number;
        total: number;
        reject_mac: number;
      }>(
        `SELECT SUM(reply = 'Access-Accept') AS accept,
                SUM(reply = 'Access-Reject') AS reject,
                COUNT(*) AS total,
                SUM(reply = 'Access-Reject' AND ${MAC}) AS reject_mac
           FROM radpostauth
          WHERE authdate >= NOW() - INTERVAL 1 DAY`,
      );
      const accept = Number(row?.accept ?? 0);
      const reject = Number(row?.reject ?? 0);
      const total = Number(row?.total ?? 0);
      const rejectMac = Number(row?.reject_mac ?? 0);

      // Alasan penolakan teratas: satu nama yang muncul puluhan kali biasanya
      // akun yang masih dipakai padahal masa aktifnya habis. Percobaan MAC
      // dibuang dari daftar ini karena bukan akun.
      const top = await this.db.query<{ username: string; total: number }>(
        `SELECT username, COUNT(*) AS total
           FROM radpostauth
          WHERE authdate >= NOW() - INTERVAL 1 DAY
            AND reply = 'Access-Reject'
            AND NOT ${MAC}
          GROUP BY username
          ORDER BY total DESC
          LIMIT 3`,
      );

      return {
        accept,
        reject,
        total,
        reject_percent: total > 0 ? Math.round((reject / total) * 100) : 0,
        reject_mac: rejectMac,
        reject_account: Math.max(0, reject - rejectMac),
        top_rejected: top.map((item) => ({ username: String(item.username), count: Number(item.total) })),
        error: null,
      };
    } catch (error) {
      this.logger.warn(`radpostauth tidak terbaca: ${message(error)}`);
      return { ...empty, error: message(error) };
    }
  }

  /**
   * Akun yang masa aktifnya habis atau habis dalam 3 hari.
   *
   * Sumbernya `radius_vouchers.expires_at` — nilai yang juga dipakai penegak,
   * jadi angka di dashboard dan tindakan sistem tidak bisa berbeda. Akun dengan
   * `expires_at` NULL (profil tanpa masa aktif) dihitung terpisah: bukan "aman",
   * hanya memang tidak punya batas.
   */
  private async expiringSoon(): Promise<ExpiringSoon> {
    const empty: ExpiringSoon = {
      overdue: 0,
      in_24h: 0,
      in_3d: 0,
      without_expiry: 0,
      rows: [],
      error: null,
    };
    try {
      const rows = await this.db.query<{
        username: string;
        profile_name: string;
        profile_type: 'hotspot' | 'ppp';
        expires_at: Date | string;
        hours_left: number;
      }>(
        `SELECT username, profile_name, profile_type, expires_at,
                TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS hours_left
           FROM radius_vouchers
          WHERE expires_at IS NOT NULL
            AND status IN ('active', 'ready-to-use')
            AND expires_at <= NOW() + INTERVAL 3 DAY
          ORDER BY expires_at ASC
          LIMIT 50`,
      );

      const counts = await this.db.queryOne<{ without_expiry: number }>(
        `SELECT COUNT(*) AS without_expiry
           FROM radius_vouchers
          WHERE expires_at IS NULL AND status IN ('active', 'ready-to-use')`,
      );

      let overdue = 0;
      let in24 = 0;
      let in3d = 0;
      for (const row of rows) {
        const hours = Number(row.hours_left);
        if (hours < 0) overdue += 1;
        else if (hours <= 24) in24 += 1;
        else in3d += 1;
      }

      return {
        overdue,
        in_24h: in24,
        in_3d: in3d,
        without_expiry: Number(counts?.without_expiry ?? 0),
        rows: rows.slice(0, 8).map((row) => ({
          username: String(row.username),
          profile_name: String(row.profile_name),
          profile_type: row.profile_type,
          expires_at: new Date(row.expires_at).toISOString(),
          days_left: Math.round(Number(row.hours_left) / 24),
        })),
        error: null,
      };
    } catch (error) {
      this.logger.warn(`radius_vouchers (expires_at) tidak terbaca: ${message(error)}`);
      return { ...empty, error: message(error) };
    }
  }

  /**
   * Sebaran voucher per profil layanan.
   *
   * Hanya `user_type = 'voucher'` — akun member punya pelanggan dan ditagih,
   * bukan dicetak. Yang dihitung per status supaya operator tahu stok mana yang
   * perlu dicetak ulang dan mana yang menumpuk tak terpakai.
   */
  private async vouchersByProfile(): Promise<VoucherProfileRow[]> {
    try {
      const rows = await this.db.query<{
        profile_name: string;
        profile_type: 'hotspot' | 'ppp';
        created: number;
        ready: number;
        used: number;
        expired: number;
        total: number;
      }>(
        `SELECT profile_name, profile_type,
                SUM(status = 'new-created') AS created,
                SUM(status = 'ready-to-use') AS ready,
                SUM(status = 'active') AS used,
                SUM(status = 'expired') AS expired,
                COUNT(*) AS total
           FROM radius_vouchers
          WHERE user_type = 'voucher'
          GROUP BY profile_name, profile_type
          ORDER BY total DESC
          LIMIT 8`,
      );
      return rows.map((row) => ({
        profile_name: String(row.profile_name),
        profile_type: row.profile_type,
        created: Number(row.created ?? 0),
        ready: Number(row.ready ?? 0),
        used: Number(row.used ?? 0),
        expired: Number(row.expired ?? 0),
        total: Number(row.total ?? 0),
      }));
    } catch (error) {
      this.logger.warn(`Sebaran voucher tidak terbaca: ${message(error)}`);
      return [];
    }
  }

  private async billing(): Promise<BillingRow> {
    // Sisa tagihan = amount dikurangi pembayaran yang tidak dibatalkan.
    const rows = await this.db.query<BillingRow>(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM packages WHERE is_active = 1) AS active_packages,
        (SELECT COUNT(*) FROM invoices) AS total_invoices,
        (SELECT COUNT(*) FROM invoices WHERE status <> 'paid') AS unpaid_count,
        (SELECT COALESCE(SUM(i.amount - COALESCE(p.paid, 0)), 0)
           FROM invoices i
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS paid
               FROM payments
              WHERE voided_at IS NULL
              GROUP BY invoice_id
           ) p ON p.invoice_id = i.id
          WHERE i.status <> 'paid') AS unpaid_total,
        (SELECT COALESCE(SUM(amount), 0) FROM payments
          WHERE voided_at IS NULL AND DATE(paid_at) = CURDATE()) AS today_revenue,
        (SELECT COUNT(*) FROM payments
          WHERE voided_at IS NULL AND DATE(paid_at) = CURDATE()) AS today_payments
    `);
    return rows[0] ?? EMPTY_BILLING;
  }

  // Online diambil dari radacct lebih dulu: RADIUS adalah dapur sistem ini.
  // Daftar active RouterOS hanya dipakai sebagai cadangan saat accounting belum
  // berjalan, dan sumbernya selalu dilaporkan agar angka tidak menipu.
  /**
   * Angka online HANYA dari radacct.
   *
   * Tidak ada cadangan lewat API perangkat: dashboard dibuka sepanjang hari
   * dan tidak boleh membuat koneksi ke router. Bila accounting belum menulis
   * apa pun, hasilnya null + pesan — bukan 0 yang terlihat seperti fakta.
   */
  private async online(): Promise<OnlineCounts> {
    const radius = await this.radiusOnline();
    if (radius) return radius;

    return {
      hotspot: null,
      ppp: null,
      unclassified: 0,
      device: 'RADIUS (radacct)',
      error:
        'Accounting RADIUS belum mencatat sesi apa pun. Periksa layanan FreeRADIUS dan ' +
        'pendaftaran NAS — angka online tidak diambil dari perangkat.',
      source: null,
    };
  }

  /**
   * Hitung sesi terbuka dari radacct.
   *
   * Mengembalikan null bila accounting belum pernah menulis apa pun — bukan 0.
   * Bedanya penting: 0 berarti "tidak ada yang online", null berarti "tidak
   * tahu". Tanpa pembedaan itu, dashboard akan berbohong saat accounting mati.
   */
  private async radiusOnline(): Promise<OnlineCounts | null> {
    try {
      // Klasifikasi memakai `radius_vouchers.profile_type` — data kita sendiri.
      // `nasporttype` TIDAK bisa diandalkan: RouterOS mengirim 'Wireless-802.11'
      // untuk klien hotspot, sehingga sesi hotspot terhitung 0.
      // nasporttype hanya dipakai sebagai cadangan bila akunnya tidak ada.
      const row = await this.db.queryOne<{
        total: number;
        hotspot: number;
        ppp: number;
        classified: number;
        last_seen: Date | null;
      }>(
        `SELECT COUNT(*) AS total,
                SUM(kind = 'hotspot') AS hotspot,
                SUM(kind = 'ppp') AS ppp,
                SUM(kind IS NOT NULL) AS classified,
                MAX(a.acctstarttime) AS last_seen
           FROM (
             SELECT a.username,
                    COALESCE(
                      v.profile_type,
                      CASE a.nasporttype
                        WHEN 'Hotspot' THEN 'hotspot'
                        WHEN 'PPP' THEN 'ppp'
                        ELSE NULL
                      END
                    ) AS kind,
                    a.acctstarttime
               FROM radacct a
               LEFT JOIN radius_vouchers v ON v.username = a.username
              WHERE a.acctstoptime IS NULL
           ) AS a`,
      );
      if (!row) return null;

      const ever = await this.db.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM radacct');
      // Belum ada satu pun baris accounting: jangan laporkan 0 sebagai fakta.
      if (!ever || Number(ever.total) === 0) return null;

      const total = Number(row.total ?? 0);
      const classified = Number(row.classified ?? 0);
      return {
        hotspot: Number(row.hotspot ?? 0),
        ppp: Number(row.ppp ?? 0),
        unclassified: Math.max(0, total - classified),
        device: 'RADIUS (radacct)',
        error: null,
        source: 'radius',
      };
    } catch (error) {
      this.logger.warn(`radacct tidak terbaca: ${message(error)}`);
      return null;
    }
  }
}

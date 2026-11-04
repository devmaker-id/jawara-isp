import { Injectable, NotFoundException } from '@nestjs/common';
import QRCode from 'qrcode';
import { DatabaseService } from '../../database/database.service';
import { WaSecurityService } from './wa-security.service';
import { WaWorkerClient } from './wa-worker.client';

/**
 * Isi halaman WhatsApp Gateway: koneksi, kebijakan, riwayat, monitoring.
 *
 * QR hanya dibuat di sini (endpoint admin terautentikasi) — tidak pernah
 * diekspos publik, dan token worker tidak pernah ikut terkirim ke browser.
 */
@Injectable()
export class WaGatewayService {
  constructor(
    private readonly worker: WaWorkerClient,
    private readonly security: WaSecurityService,
    private readonly db: DatabaseService,
  ) {}

  async status() {
    let health: Awaited<ReturnType<WaWorkerClient['health']>> | null = null;
    let error: string | null = null;
    try {
      health = await this.worker.health();
    } catch (e) {
      error = (e as Error).message;
    }
    const counts = await this.db.queryOne<{ total: number; inbound: number; outbound: number; commands: number; failed: number }>(
      `SELECT COUNT(*) AS total,
              SUM(direction = 'in') AS inbound,
              SUM(direction = 'out') AS outbound,
              SUM(processing = 'direct') AS commands,
              SUM(reply_status = 'failed') AS failed
         FROM wa_messages`,
    );
    return {
      worker_online: health !== null,
      worker_error: error,
      connection: health?.status ?? 'offline',
      number: health?.number ?? null,
      connected_at: health?.connected_at ?? null,
      qr_available: health?.qr_available ?? false,
      reconnect_count: health?.reconnect_count ?? 0,
      last_error: health?.last_error ?? null,
      counters: {
        messages: Number(counts?.total ?? 0),
        inbound: Number(counts?.inbound ?? 0),
        outbound: Number(counts?.outbound ?? 0),
        commands: Number(counts?.commands ?? 0),
        failed: Number(counts?.failed ?? 0),
      },
    };
  }

  async qr(): Promise<{ qr: string | null; at: string | null; image: string | null }> {
    const { qr, at } = await this.worker.qr();
    if (!qr) return { qr: null, at, image: null };
    const image = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    return { qr, at, image };
  }

  connect() {
    return this.worker.connect();
  }

  logout() {
    return this.worker.logout();
  }

  /** Ganti nomor / pairing ulang: sesi lama dihapus, QR baru dibuat. */
  repair() {
    return this.worker.repair();
  }

  /** Hapus satu baris riwayat pesan. */
  async deleteMessage(id: number) {
    const result = await this.db.execute('DELETE FROM wa_messages WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw new NotFoundException('Pesan tidak ditemukan');
    return { ok: true, id };
  }

  /** Hapus satu baris log kejadian (reconnect, error, dsb). */
  async deleteEvent(id: number) {
    const result = await this.db.execute('DELETE FROM wa_events WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw new NotFoundException('Catatan log tidak ditemukan');
    return { ok: true, id };
  }

  async settings() {
    const [policy, rows] = await Promise.all([
      this.security.policy(),
      this.db.query<{ setting_key: string; setting_value: string }>(
        'SELECT setting_key, setting_value FROM wa_settings ORDER BY setting_key',
      ),
    ]);
    return { policy, values: Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])) };
  }

  async saveSettings(values: Record<string, string>) {
    const allowed = new Set([
      'dm_policy',
      'group_policy',
      'require_mention',
      'gateway_enabled',
    ]);
    const entries = Object.entries(values ?? {}).filter(([key]) => allowed.has(key));
    if (entries.length === 0) throw new NotFoundException('Tidak ada pengaturan yang dikenal');
    for (const [key, value] of entries) {
      await this.security.upsertSetting(key, String(value).slice(0, 100));
    }
    return this.settings();
  }

  async allowlist() {
    return this.db.query(
      `SELECT id, kind, value, label, is_admin, is_active, created_at
         FROM wa_allowlist ORDER BY kind, value`,
    );
  }

  async addAllowlist(input: { kind: 'number' | 'group'; value: string; label?: string; is_admin?: boolean }) {
    const value = String(input.value ?? '').trim();
    if (!value) throw new NotFoundException('Nomor/grup wajib diisi');
    await this.db.execute(
      `INSERT INTO wa_allowlist (kind, value, label, is_admin)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), is_admin = VALUES(is_admin), is_active = 1`,
      [input.kind, value.slice(0, 64), input.label?.slice(0, 100) ?? null, input.is_admin ? 1 : 0],
    );
    return this.allowlist();
  }

  async toggleAllowlist(id: number, active: boolean) {
    await this.db.execute('UPDATE wa_allowlist SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    return this.allowlist();
  }

  async removeAllowlist(id: number) {
    await this.db.execute('DELETE FROM wa_allowlist WHERE id = ?', [id]);
    return this.allowlist();
  }

  async messages(limit = 50) {
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.db.query(
      `SELECT id, direction, chat_id, chat_type, sender, body_preview, body,
              processing, command, reply_status, error_note, created_at
         FROM wa_messages ORDER BY id DESC LIMIT ${size}`,
    );
  }

  /** Hapus banyak baris riwayat pesan sekaligus. */
  async deleteMessages(ids: number[]) {
    const clean = (ids ?? []).filter((id) => Number.isInteger(Number(id)) && Number(id) > 0);
    if (clean.length === 0) return { removed: 0 };
    const result = await this.db.execute(
      `DELETE FROM wa_messages WHERE id IN (${clean.map(() => '?').join(',')})`,
      clean,
    );
    return { removed: Number(result.affectedRows ?? 0) };
  }

  async monitor() {
    const [events, daily] = await Promise.all([
      this.db.query('SELECT id, kind, message, created_at FROM wa_events ORDER BY id DESC LIMIT 20'),
      this.db.query(
        `SELECT DATE(created_at) AS day,
                SUM(direction = 'in') AS inbound,
                SUM(direction = 'out') AS outbound,
                SUM(processing = 'direct') AS direct,
                SUM(processing = 'denied') AS denied,
                SUM(processing = 'error') AS errors
           FROM wa_messages GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 14`,
      ),
    ]);
    return { events, daily };
  }

  commands() {
    // Controller meneruskan daftar dari WaRouterService; method ini hanya
    // penanda agar modul tetap punya satu pintu.
    return { rows: [] as unknown[] };
  }
}

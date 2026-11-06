import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { OltRepository, OltDeviceRow } from '../olt.repository';
import { WaWorkerClient } from '../../whatsapp-gateway/wa-worker.client';
import { ConfigService } from '../../../config/config.service';
import { createAdapter } from '../driver/registry';
import { decryptOltSecret } from '../olt-crypto';
import type { ConnectionState, OltConnection } from '../driver/olt-driver';
import type { ParsedSyslogEvent } from './syslog.parser';
import { parseOnuInfoCtc } from '../vendors/hisfocus/hisfocus.parser';

/**
 * Handler event syslog → inventori ONU + alert WhatsApp.
 *
 * Setiap event ONU (up/down/dying gasp/registrasi) dari kolektor syslog diproses
 * di sini menurut konfigurasi (tabel `config`, key `olt_syslog_handlers`):
 *
 *   - inventory_sync : perbarui `olt_onus` (online + last_event + connection_state).
 *   - whatsapp_alert : kirim alert ke group WhatsApp saat status berubah.
 *   - alert_events   : jenis event yang memicu alert (ONU_LINKDOWN, ONU_DYING_GASP, …).
 *   - routes         : daftar rute (olt_id → grup WhatsApp tujuan).
 *
 * Alert dide-duplikasi lewat hasil `applySyslogOnuEvent` (hanya ditulis saat
 * status berubah), sehingga ONU yang mengirim beberapa event down beruntun hanya
 * menghasilkan satu alert, dan satu alert lagi saat kembali up.
 */

/** Rute alert WhatsApp: sumber (OLT) → tujuan (grup). */
export interface SyslogRoute {
  olt_id: number;
  whatsapp_group: string;
}

export interface SyslogHandlerConfig {
  inventory_sync: boolean;
  whatsapp_alert: boolean;
  alert_events: string[];
  /** Rute pengiriman alert per OLT: syslog dari olt_id dikirim ke whatsapp_group. */
  routes: SyslogRoute[];
  /** Jeda minimum (detik) antar dua pesan WhatsApp untuk ONU yang sama. */
  spacing_seconds: number;
  /** Batas event beruntun untuk ONU yang sama; setelahnya dianggap flap dan pengiriman dihentikan. */
  flap_threshold: number;
}

const CONFIG_KEY = 'olt_syslog_handlers';
const CACHE_TTL_MS = 15_000;

export const DEFAULT_HANDLER_CONFIG: SyslogHandlerConfig = {
  inventory_sync: false,
  whatsapp_alert: false,
  alert_events: ['ONU_LINKDOWN', 'ONU_DYING_GASP'],
  routes: [],
  spacing_seconds: 300,
  flap_threshold: 3,
};

export const ALERTABLE_EVENT_TYPES = [
  'ONU_LINKUP',
  'ONU_LINKDOWN',
  'ONU_REGISTER',
  'ONU_DEREGISTER',
  'ONU_DYING_GASP',
] as const;

const EVENT_TO_ONLINE: Record<string, 0 | 1> = {
  ONU_LINKUP: 1,
  ONU_REGISTER: 1,
  ONU_LINKDOWN: 0,
  ONU_DEREGISTER: 0,
  ONU_DYING_GASP: 0,
};

const EVENT_LABEL: Record<string, string> = {
  ONU_LINKUP: '🟢 ONU UP',
  ONU_REGISTER: '🔵 ONU REGISTRASI',
  ONU_LINKDOWN: '🔴 ONU DOWN',
  ONU_DEREGISTER: '🔴 ONU DEREGISTRASI',
  ONU_DYING_GASP: '⚠️ ONU DAYA MATI (dying gasp)',
};

const CAUSE_LABEL: Record<ConnectionState, string> = {
  ONLINE: 'Kembali terhubung',
  OFFLINE: 'Terputus (sebab dicek sinkronisasi)',
  ONU_POWER_OFF: 'Listrik padam (power off)',
  FIBER_LOS: 'Fiber putus (LOS)',
  ONU_AUTH_FAILED: 'Gagal autentikasi',
  UNKNOWN: 'Belum diketahui',
};

/** Konteks pengaya alert: identitas pelanggan atau perangkat + redaman. */
interface AlertContext {
  customerName: string | null;
  internetNo: string | null;
  perangkat: string | null;
  redaman: string | null;
}

/** Jejak event beruntun per ONU (dedup + deteksi flap). Hanya di memori. */
interface FlapState {
  count: number;
  lastSentAt: number;
  suppressed: boolean;
  timer: NodeJS.Timeout;
}

export function normalizeHandlerConfig(input: Partial<SyslogHandlerConfig>): SyslogHandlerConfig {
  const alertEvents = Array.isArray(input.alert_events)
    ? input.alert_events
        .filter((event) => (ALERTABLE_EVENT_TYPES as readonly string[]).includes(event))
        .slice(0, 20)
    : [...DEFAULT_HANDLER_CONFIG.alert_events];
  const rawSpacing = Number(input.spacing_seconds);
  const spacing = Number.isFinite(rawSpacing)
    ? Math.min(Math.max(Math.round(rawSpacing), 1), 3600)
    : DEFAULT_HANDLER_CONFIG.spacing_seconds;
  const rawThreshold = Number(input.flap_threshold);
  const threshold = Number.isFinite(rawThreshold)
    ? Math.min(Math.max(Math.round(rawThreshold), 1), 100)
    : DEFAULT_HANDLER_CONFIG.flap_threshold;
  const routes = Array.isArray(input.routes)
    ? input.routes
        .filter((route) => route && typeof route.olt_id === 'number' && Number.isFinite(route.olt_id))
        .map((route) => ({
          olt_id: Math.trunc(route.olt_id),
          whatsapp_group: String(route.whatsapp_group ?? '').trim().slice(0, 64),
        }))
        .filter((route) => route.whatsapp_group.length > 0)
        .slice(0, 200)
    : [];

  return {
    inventory_sync: input.inventory_sync === true,
    whatsapp_alert: input.whatsapp_alert === true,
    alert_events: alertEvents,
    routes,
    spacing_seconds: spacing,
    flap_threshold: threshold,
  };
}

@Injectable()
export class SyslogEventHandlerService {
  private readonly logger = new Logger(SyslogEventHandlerService.name);
  private cache: SyslogHandlerConfig | null = null;
  private cachedAt = 0;
  private readonly flaps = new Map<string, FlapState>();
  /** ONU yang sedang diprobe telnet-nya — cegah probe ganda saat flap. */
  private readonly probing = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: OltRepository,
    private readonly worker: WaWorkerClient,
    private readonly config: ConfigService,
  ) {}

  async getConfig(): Promise<SyslogHandlerConfig> {
    if (this.cache && Date.now() - this.cachedAt < CACHE_TTL_MS) return this.cache;
    const row = await this.db.queryOne<{ config_value: string }>(
      'SELECT config_value FROM config WHERE config_key = ?',
      [CONFIG_KEY],
    );
    let parsed: Partial<SyslogHandlerConfig> = {};
    if (row?.config_value) {
      try {
        parsed = JSON.parse(row.config_value) as Partial<SyslogHandlerConfig>;
      } catch {
        parsed = {};
      }
    }
    this.cache = normalizeHandlerConfig(parsed);
    this.cachedAt = Date.now();
    return this.cache;
  }

  async setConfig(config: Partial<SyslogHandlerConfig>): Promise<SyslogHandlerConfig> {
    const normalized = normalizeHandlerConfig(config);
    await this.db.execute(
      `INSERT INTO config (config_key, config_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
      [CONFIG_KEY, JSON.stringify(normalized)],
    );
    this.cache = normalized;
    this.cachedAt = Date.now();
    return normalized;
  }

  /** Dipanggil kolektor setelah event tersimpan. Tidak melempar — aman di jalur ingest. */
  async onEvent(parsed: ParsedSyslogEvent, sourceIp: string): Promise<void> {
    const online = EVENT_TO_ONLINE[parsed.eventType];
    if (online === undefined) return;

    try {
      const device = await this.repository.findDeviceByIp(sourceIp);
      if (!device) return;
      const config = await this.getConfig();

      // Sebab offline realtime: syslog HiFocus cuma memberi linkdown (generik),
      // sebab sebenarnya dibaca lewat telnet `show onu info epon <port> <id>`.
      let connectionState: ConnectionState | null =
        parsed.connectionState ?? (online ? 'ONLINE' : 'OFFLINE');
      if (online === 0 && parsed.portId && parsed.onuId) {
        connectionState = (await this.resolveOfflineCause(device.id, parsed)) ?? connectionState;
      }
      const enriched: ParsedSyslogEvent = { ...parsed, connectionState };

      let changed = false;
      if (config.inventory_sync) {
        changed = (
          await this.repository.applySyslogOnuEvent({
            oltId: device.id,
            portId: parsed.portId,
            onuId: parsed.onuId,
            onuMac: parsed.onuMac,
            online,
            eventType: parsed.eventType,
            connectionState: connectionState ?? 'OFFLINE',
          })
        ).changed;
      }

      if (config.whatsapp_alert && config.alert_events.includes(parsed.eventType)) {
        const destinations = config.routes
          .filter((route) => route.olt_id === device.id)
          .map((route) => route.whatsapp_group);

        if (destinations.length === 0) return;

        // Bila inventori ikut dilacak, hanya beri tahu pada perubahan status;
        // tanpa pelacakan, beri tahu setiap event yang cocok.
        if (config.inventory_sync && !changed) return;

        const row = await this.repository
          .findOnuAlertContext(device.id, parsed.portId, parsed.onuId, parsed.onuMac)
          .catch(() => null);
        const context = this.buildContext(parsed, row);
        this.alertWithDedup(config, destinations, device.id, device.name, enriched, context);
      }
    } catch (error) {
      this.logger.warn(`Handler event ONU gagal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Bangun koneksi OLT dari baris perangkat (dekripsi kredensial). Baca-saja. */
  private buildConnection(device: OltDeviceRow): OltConnection {
    return {
      vendor: device.vendor,
      transport: device.transport,
      host: device.host,
      port: Number(device.port),
      username: device.username,
      password: decryptOltSecret(device.password_enc, this.config.secretKey),
      enablePassword: device.enable_password_enc
        ? decryptOltSecret(device.enable_password_enc, this.config.secretKey)
        : null,
      promptPattern: device.prompt_pattern,
    };
  }

  /**
   * Baca sebab offline ONU HiFocus/Hioso via telnet (read-only), saat event
   * syslog masuk. VSOL/Global dilewati — sebabnya sudah ada di teks event.
   */
  private async resolveOfflineCause(
    deviceId: number,
    parsed: ParsedSyslogEvent,
  ): Promise<ConnectionState | null> {
    if (!parsed.portId || !parsed.onuId) return null;
    const device = await this.repository.findDevice(deviceId);
    if (!device) return null;
    const vendor = (device.vendor ?? '').trim().toLowerCase();
    if (vendor !== 'hisfocus' && vendor !== 'hioso') return null;

    const key = `${deviceId}:${parsed.portId}/${parsed.onuId}`;
    if (this.probing.has(key)) return null;
    this.probing.add(key);
    try {
      const adapter = createAdapter(this.buildConnection(device));
      try {
        await adapter.open();
        const raw = await adapter.readOnuInfo?.(parsed.portId, parsed.onuId);
        if (raw == null) return null;
        return parseOnuInfoCtc(raw);
      } finally {
        await adapter.close().catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn(
        `Probe telnet sebab ONU gagal (${deviceId} ${parsed.portId}/${parsed.onuId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      this.probing.delete(key);
    }
  }

  /** Gabungkan data event + baris inventori menjadi konteks pesan yang siap tampil. */
  private buildContext(
    parsed: ParsedSyslogEvent,
    row: Awaited<ReturnType<OltRepository['findOnuAlertContext']>>,
  ): AlertContext {
    const perangkat =
      parsed.onuName ||
      row?.onuName ||
      parsed.onuMac ||
      parsed.onuSerial ||
      row?.serialNumber ||
      row?.onuMac ||
      null;

    const redamanDb = row ? (row.rxPowerOlt ?? row.rxPowerOnu) : null;
    const redaman =
      redamanDb != null
        ? `${redamanDb} dBm${row?.opticalReadAt ? ` (terakhir ${row.opticalReadAt.getHours().toString().padStart(2, '0')}:${row.opticalReadAt.getMinutes().toString().padStart(2, '0')})` : ''}`
        : null;

    return {
      customerName: row?.customerName ?? null,
      internetNo: row?.internetNo ?? null,
      perangkat,
      redaman,
    };
  }

  private async sendAlert(
    group: string,
    parsed: ParsedSyslogEvent,
    oltName: string,
    context: AlertContext,
  ): Promise<void> {
    const label = EVENT_LABEL[parsed.eventType] ?? parsed.eventType;
    const ponOnu = parsed.portId && parsed.onuId ? `${parsed.portId}/${parsed.onuId}` : '—';
    const isDown = EVENT_TO_ONLINE[parsed.eventType] === 0;
    const cause = isDown && parsed.connectionState ? CAUSE_LABEL[parsed.connectionState] : null;

    const text = [
      label,
      context.customerName ? `*Pelanggan*: ${context.customerName}` : '',
      context.internetNo ? `*No. Internet*: ${context.internetNo}` : '',
      !context.customerName && context.perangkat ? `*Perangkat*: ${context.perangkat}` : '',
      `*OLT*: ${oltName}`,
      `*PON/ONU*: ${ponOnu}`,
      cause ? `*Penyebab*: ${cause}` : '',
      context.redaman ? `*Redaman*: ${context.redaman}` : '',
      `*Waktu*: ${new Date().toLocaleString('id-ID')}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await this.worker.send(group, text);
    } catch (error) {
      this.logger.warn(`Alert WhatsApp gagal dikirim: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Kirim alert dengan pembatas flap:
   *   - `spacing_seconds` : jarak minimum antar dua pesan untuk ONU yang sama.
   *     Kejadian yang terlalu rapat tidak dikirim (dilewati), tetapi tetap
   *     dihitung sebagai indikasi kegagalan berulang.
   *   - `flap_threshold`  : setelah N event beruntun untuk ONU yang sama, anggap
   *     bolak-balik (flap) dan hentikan pengiriman sepenuhnya — tanpa pesan
   *     ringkasan flap, hanya dicatat ke log.
   * Status flap direset otomatis setelah ONU hening selama 2× spacing.
   */
  private alertWithDedup(
    config: SyslogHandlerConfig,
    destinations: string[],
    oltId: number,
    oltName: string,
    parsed: ParsedSyslogEvent,
    context: AlertContext,
  ): void {
    const key = this.onuKey(oltId, parsed);
    const now = Date.now();
    let state = this.flaps.get(key);
    if (!state) {
      state = {
        count: 0,
        lastSentAt: 0,
        suppressed: false,
        timer: null as unknown as NodeJS.Timeout,
      };
      this.flaps.set(key, state);
    }

    // Selama ONU masih mengirim event, tunda reset status flap sampai hening.
    this.armFlapReset(state, key, config.spacing_seconds);

    if (state.suppressed) return;

    // Hitung semua event beruntun — inilah sinyal "flap", bukan jumlah kiriman.
    state.count += 1;

    const spacingMs = config.spacing_seconds * 1000;
    if (state.lastSentAt === 0 || now - state.lastSentAt >= spacingMs) {
      state.lastSentAt = now;
      for (const group of destinations) {
        void this.sendAlert(group, parsed, oltName, context);
      }
    }

    if (state.count >= config.flap_threshold) {
      state.suppressed = true;
      const ponOnu = parsed.portId && parsed.onuId ? `${parsed.portId}/${parsed.onuId}` : '—';
      this.logger.warn(
        `ONU ${oltName} ${ponOnu} dianggap flap setelah ${state.count} event beruntun; alert WhatsApp dihentikan.`,
      );
    }
  }

  /** Reset status flap bila ONU hening selama 2× jeda antar pesan. */
  private armFlapReset(state: FlapState, key: string, spacingSeconds: number): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      this.flaps.delete(key);
    }, spacingSeconds * 1000 * 2);
    state.timer.unref?.();
  }

  private onuKey(oltId: number, parsed: ParsedSyslogEvent): string {
    if (parsed.portId && parsed.onuId) return `${oltId}:${parsed.portId}/${parsed.onuId}`;
    return `${oltId}:${parsed.onuMac ?? 'noport'}`;
  }
}
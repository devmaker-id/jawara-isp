import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { OltRepository } from '../olt.repository';
import { WaWorkerClient } from '../../whatsapp-gateway/wa-worker.client';
import type { ParsedSyslogEvent } from './syslog.parser';

/**
 * Handler event syslog → inventori ONU + alert WhatsApp.
 *
 * Setiap event ONU (up/down/dying gasp/registrasi) dari kolektor syslog diproses
 * di sini menurut konfigurasi (tabel `config`, key `olt_syslog_handlers`):
 *
 *   - inventory_sync : perbarui `olt_onus` (online + last_event) saat status berubah.
 *   - whatsapp_alert : kirim alert ke group WhatsApp saat status berubah.
 *   - alert_events   : jenis event yang memicu alert (ONU_LINKDOWN, ONU_DYING_GASP, …).
 *   - whatsapp_group : id grup tujuan (dari allowlist WhatsApp Gateway).
 *
 * Alert dide-duplikasi lewat hasil `applySyslogOnuEvent` (hanya ditulis saat
 * status berubah), sehingga ONU yang mengirim beberapa event down beruntun hanya
 * menghasilkan satu alert, dan satu alert lagi saat kembali up.
 */

export interface SyslogHandlerConfig {
  inventory_sync: boolean;
  whatsapp_alert: boolean;
  whatsapp_group: string;
  alert_events: string[];
  /** Jeda (menit) minimal antar pesan untuk ONU yang sama; flap dalam jeda ini dirangkum jadi satu pesan. */
  cooldown_minutes: number;
}

const CONFIG_KEY = 'olt_syslog_handlers';
const CACHE_TTL_MS = 15_000;

export const DEFAULT_HANDLER_CONFIG: SyslogHandlerConfig = {
  inventory_sync: false,
  whatsapp_alert: false,
  whatsapp_group: '',
  alert_events: ['ONU_LINKDOWN', 'ONU_DYING_GASP'],
  cooldown_minutes: 10,
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

/** Jejak flap (mati/hidup berulang) per ONU selama jendela cooldown. Hanya di memori. */
interface FlapRecord {
  group: string;
  oltName: string;
  ponOnu: string;
  perangkat: string | null;
  count: number;
  firstAt: number;
  lastAt: number;
  timer: NodeJS.Timeout;
}

export function normalizeHandlerConfig(input: Partial<SyslogHandlerConfig>): SyslogHandlerConfig {
  const alertEvents = Array.isArray(input.alert_events)
    ? input.alert_events
        .filter((event) => (ALERTABLE_EVENT_TYPES as readonly string[]).includes(event))
        .slice(0, 20)
    : [...DEFAULT_HANDLER_CONFIG.alert_events];
  const rawCooldown = Number(input.cooldown_minutes);
  const cooldown = Number.isFinite(rawCooldown)
    ? Math.min(Math.max(Math.round(rawCooldown), 1), 60)
    : DEFAULT_HANDLER_CONFIG.cooldown_minutes;
  return {
    inventory_sync: input.inventory_sync === true,
    whatsapp_alert: input.whatsapp_alert === true,
    whatsapp_group: String(input.whatsapp_group ?? '').trim().slice(0, 64),
    alert_events: alertEvents,
    cooldown_minutes: cooldown,
  };
}

@Injectable()
export class SyslogEventHandlerService {
  private readonly logger = new Logger(SyslogEventHandlerService.name);
  private cache: SyslogHandlerConfig | null = null;
  private cachedAt = 0;
  private readonly flaps = new Map<string, FlapRecord>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: OltRepository,
    private readonly worker: WaWorkerClient,
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
          })
        ).changed;
      }

      if (
        config.whatsapp_alert &&
        config.whatsapp_group &&
        config.alert_events.includes(parsed.eventType)
      ) {
        // Bila inventori ikut dilacak, hanya beri tahu pada perubahan status;
        // tanpa pelacakan, beri tahu setiap event yang cocok.
        if (config.inventory_sync && !changed) return;
        this.alertWithCooldown(config, device.id, device.name, parsed);
      }
    } catch (error) {
      this.logger.warn(`Handler event ONU gagal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async sendAlert(group: string, parsed: ParsedSyslogEvent, oltName: string): Promise<void> {
    const label = EVENT_LABEL[parsed.eventType] ?? parsed.eventType;
    const ponOnu = parsed.portId && parsed.onuId ? `${parsed.portId}/${parsed.onuId}` : '—';
    const perangkat = parsed.onuName || parsed.onuMac || null;
    const text = [
      label,
      `*OLT*: ${oltName}`,
      `*PON/ONU*: ${ponOnu}`,
      perangkat ? `*Perangkat*: ${perangkat}` : '',
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
   * Kirim alert dengan pembatas flap: kejadian pertama untuk satu ONU dikirim
   * seketika, kejadian berikutnya dalam jendela cooldown ditahan lalu dirangkum
   * menjadi satu pesan "bolak-balik mati/hidup N kali" saat jendela berakhir.
   */
  private alertWithCooldown(
    config: SyslogHandlerConfig,
    oltId: number,
    oltName: string,
    parsed: ParsedSyslogEvent,
  ): void {
    const key = this.onuKey(oltId, parsed);
    const now = Date.now();
    const existing = this.flaps.get(key);

    if (existing) {
      existing.count += 1;
      existing.lastAt = now;
      return; // ditahan — dirangkum oleh flushFlap
    }

    const ponOnu = parsed.portId && parsed.onuId ? `${parsed.portId}/${parsed.onuId}` : '—';
    const perangkat = parsed.onuName || parsed.onuMac || null;

    const record: FlapRecord = {
      group: config.whatsapp_group,
      oltName,
      ponOnu,
      perangkat,
      count: 1,
      firstAt: now,
      lastAt: now,
      timer: null as unknown as NodeJS.Timeout,
    };
    this.flaps.set(key, record);

    record.timer = setTimeout(() => this.flushFlap(key), config.cooldown_minutes * 60_000);
    record.timer.unref?.();

    void this.sendAlert(config.whatsapp_group, parsed, oltName);
  }

  private flushFlap(key: string): void {
    const record = this.flaps.get(key);
    if (!record) return;
    this.flaps.delete(key);
    if (record.count <= 1) return; // tidak ada flap — pesan awal sudah cukup

    const span = Math.max(1, Math.round((record.lastAt - record.firstAt) / 60000));
    const text = [
      '🔁 ONU bolak-balik mati/hidup (flap)',
      `*OLT*: ${record.oltName}`,
      `*PON/ONU*: ${record.ponOnu}`,
      record.perangkat ? `*Perangkat*: ${record.perangkat}` : '',
      `*Kejadian*: ${record.count} kali dalam ±${span} menit`,
    ]
      .filter(Boolean)
      .join('\n');

    this.worker.send(record.group, text).catch((error) => {
      this.logger.warn(`Alert flap gagal dikirim: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private onuKey(oltId: number, parsed: ParsedSyslogEvent): string {
    if (parsed.portId && parsed.onuId) return `${oltId}:${parsed.portId}/${parsed.onuId}`;
    return `${oltId}:${parsed.onuMac ?? 'noport'}`;
  }
}
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { DatabaseService } from '../../database/database.service';
import { OltConnection, OltOnu, OltOptical } from './driver/olt-driver';
import { createAdapter, supportedVendors } from './driver/registry';
import { CreateOltDeviceDto, UpdateOltDeviceDto } from './dto/olt.dto';
import { decryptOltSecret, encryptOltSecret } from './olt-crypto';
import { OltDeviceRow, OltDeviceView, OltOnuFilter, OltRepository } from './olt.repository';

/**
 * Layanan OLT — baca-saja.
 *
 * Panel ini TIDAK menulis konfigurasi OLT: tidak ada tambah/hapus ONU, tidak
 * ada `save`, tidak ada reboot. Yang dilakukan hanya membuka sesi, membaca
 * inventori, lalu menyimpannya ke database panel.
 *
 * Setiap sesi dibuka lewat `createAdapter()` dan SELALU ditutup di `finally`.
 * Tanpa itu, satu perintah yang gagal meninggalkan sesi menggantung dan OLT
 * bisa menolak sesi berikutnya.
 */

export interface SyncResult {
  olt_id: number;
  identity: string | null;
  ports: string[];
  onu_total: number;
  onu_online: number;
  saved: number;
  removed: number;
  /** Jumlah ONU yang redamannya dibaca pada run ini (vendor per-ONU). */
  optical_scanned: number;
  duration_ms: number;
}

/**
 * Batas pembacaan redaman untuk vendor yang butuh satu perintah per ONU
 * (HiFocus). Dibatasi oleh JUMLAH dan WAKTU, karena:
 *   - satu permintaan harus selesai jauh di bawah batas 100 detik Cloudflare,
 *   - OLT tetap bisa dipakai operator lain selama pembacaan.
 *
 * Perangkat yang lebih lambat akan berhenti karena waktu, bukan karena kuota;
 * perangkat cepat bisa menyelesaikan kuota. Sisa ONU terbaca pada sync
 * berikutnya (diurutkan dari yang paling lama belum dibaca).
 */
const OPTICAL_BATCH_MAX = 60;
const OPTICAL_TIME_BUDGET_MS = 20_000;

/** Satu sync per perangkat pada satu waktu. */
const running = new Set<number>();

@Injectable()
export class OltService {
  private readonly logger = new Logger(OltService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: OltRepository,
    private readonly config: ConfigService,
  ) {}

  supportedVendors(): string[] {
    return supportedVendors();
  }

  async listDevices(): Promise<{ rows: OltDeviceView[]; vendors: string[] }> {
    return { rows: await this.repository.listDevices(), vendors: this.supportedVendors() };
  }

  async createDevice(dto: CreateOltDeviceDto, actor: { userId: number; ip: string }) {
    const vendor = (dto.vendor ?? 'vsol').toLowerCase();
    this.assertVendor(vendor);

    try {
      const id = await this.repository.createDevice({
        name: dto.name.trim(),
        vendor,
        transport: dto.transport ?? 'ssh',
        host: dto.host.trim(),
        port: dto.port ?? (dto.transport === 'telnet' ? 23 : 22),
        username: dto.username.trim(),
        passwordEnc: encryptOltSecret(dto.password, this.config.secretKey),
        enablePasswordEnc: dto.enable_password
          ? encryptOltSecret(dto.enable_password, this.config.secretKey)
          : null,
        ponPorts: this.normalizePorts(dto.pon_ports),
        promptPattern: dto.prompt_pattern?.trim() || null,
        createdBy: actor.userId,
      });
      await this.audit(actor, 'OLT_DEVICE_CREATED', { id, name: dto.name, host: dto.host, vendor });
      return { id };
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException(
          'Perangkat dengan host dan port itu sudah terdaftar. Ubah data yang ada, bukan menambah baru.',
        );
      }
      throw error;
    }
  }

  async updateDevice(
    id: number,
    dto: UpdateOltDeviceDto,
    actor: { userId: number; ip: string },
  ) {
    const existing = await this.requireDevice(id);
    const values: Record<string, unknown> = {};

    if (dto.name !== undefined) values.name = dto.name.trim();
    if (dto.vendor !== undefined) {
      const vendor = dto.vendor.toLowerCase();
      this.assertVendor(vendor);
      values.vendor = vendor;
    }
    if (dto.transport !== undefined) values.transport = dto.transport;
    if (dto.host !== undefined) values.host = dto.host.trim();
    if (dto.port !== undefined) values.port = dto.port;
    if (dto.username !== undefined) values.username = dto.username.trim();
    if (dto.password) values.password_enc = encryptOltSecret(dto.password, this.config.secretKey);
    if (dto.enable_password) {
      values.enable_password_enc = encryptOltSecret(dto.enable_password, this.config.secretKey);
    }
    if (dto.pon_ports !== undefined) values.pon_ports = this.normalizePorts(dto.pon_ports);
    if (dto.prompt_pattern !== undefined) values.prompt_pattern = dto.prompt_pattern.trim() || null;
    if (dto.is_active !== undefined) values.is_active = dto.is_active ? 1 : 0;

    if (Object.keys(values).length === 0) {
      throw new BadRequestException('Tidak ada perubahan yang dikirim.');
    }

    try {
      await this.repository.updateDevice(id, values);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Host dan port itu sudah dipakai perangkat lain.');
      }
      throw error;
    }

    await this.audit(actor, 'OLT_DEVICE_UPDATED', {
      id,
      fields: Object.keys(values),
      name: existing.name,
    });
    return { ok: true };
  }

  async removeDevice(id: number, actor: { userId: number; ip: string }) {
    const existing = await this.requireDevice(id);
    const counts = await this.repository.countOnus(id);
    await this.repository.removeDevice(id);
    await this.audit(actor, 'OLT_DEVICE_DELETED', {
      id,
      name: existing.name,
      host: existing.host,
      onu_removed: counts.total,
    });
    return { ok: true };
  }

  /**
   * Uji koneksi: buka sesi, baca satu port PON pertama, tutup.
   * Tidak menulis inventori — hanya membuktikan kredensial dan driver cocok.
   */
  async testDevice(id: number, actor: { userId: number; ip: string }) {
    const device = await this.requireDevice(id);
    const ports = this.ports(device);
    const started = Date.now();
    let identity: string | null = null;

    try {
      const connection = this.connection(device);
      const adapter = createAdapter(connection);
      try {
        const opened = await adapter.open();
        identity = opened.prompt;
        const onus = await adapter.readOnus(ports[0]);
        const online = onus.filter((onu) => onu.online).length;

        await this.repository.touchStatus(id, {
          connected: true,
          message: `OK — ${onus.length} ONU di port ${ports[0]} (${online} online) pada ${device.host}:${device.transport === 'telnet' ? 'telnet' : 'ssh'}`,
          identity,
          version: opened.version,
        });
        await this.audit(actor, 'OLT_DEVICE_TESTED', { id, connected: true, onu: onus.length });

        return {
          connected: true,
          identity,
          version: opened.version,
          port: ports[0],
          onu_total: onus.length,
          onu_online: online,
          duration_ms: Date.now() - started,
          message: `Terhubung. ${onus.length} ONU terbaca di port ${ports[0]}.`,
        };
      } finally {
        await adapter.close().catch(() => undefined);
      }
    } catch (error) {
      const message = this.describe(error);
      await this.repository.touchStatus(id, {
        connected: false,
        message,
        identity,
        version: null,
      });
      await this.audit(actor, 'OLT_DEVICE_TESTED', { id, connected: false, message });
      throw new ServiceUnavailableException(message);
    }
  }

  /**
   * Baca inventori semua port PON lalu simpan.
   *
   * Kegagalan di satu port menghentikan seluruh run: lebih baik inventori
   * setengah jadi tidak ditulis daripada data lama terhapus tanpa pengganti.
   */
  async syncDevice(id: number, actor: { userId: number; ip: string }): Promise<SyncResult> {
    const device = await this.requireDevice(id);
    if (device.is_active !== 1) {
      throw new BadRequestException('Perangkat OLT ini sedang dinonaktifkan.');
    }
    if (running.has(id)) {
      throw new ConflictException(
        'Pembacaan untuk perangkat ini masih berjalan. Tunggu selesai sebelum menjalankan lagi.',
      );
    }

    const ports = this.ports(device);
    const started = Date.now();
    running.add(id);
    const runId = await this.repository.startRun(id, actor.userId);

    let identity: string | null = null;
    let version: string | null = null;
    let opticalScanned = 0;
    let saved = { saved: 0, removed: 0 };
    const collected: OltOnu[] = [];

    try {
      const adapter = createAdapter(this.connection(device));
      try {
        const opened = await adapter.open();
        identity = opened.prompt;
        version = opened.version;
        for (const port of ports) {
          const onus = await adapter.readOnus(port);
          collected.push(...onus);
        }

        // Inventori disimpan lebih dulu supaya daftar kandidat redaman sudah
        // memuat ONU yang baru ditemukan pada run ini.
        saved = await this.repository.saveInventory(id, ports, collected);

        if (adapter.opticalInInventory !== true && adapter.readOptical) {
          const candidates = await this.repository.opticalCandidates(id, OPTICAL_BATCH_MAX);
          const deadline = Date.now() + OPTICAL_TIME_BUDGET_MS;
          for (const candidate of candidates) {
            if (Date.now() > deadline) break;

            const optical = await this.readOpticalWithRetry(adapter, candidate.port_id, candidate.onu_id);
            if (!optical) {
              // Tidak ada Rx = jangan ditandai "sudah dibaca". ONU ini akan
              // dicoba lagi pada sync berikutnya, bukan dianggap selesai.
              continue;
            }
            await this.repository.saveOptical(id, candidate.port_id, candidate.onu_id, optical);
            opticalScanned += 1;
          }
        }
      } finally {
        await adapter.close().catch(() => undefined);
      }

      const online = collected.filter((onu) => onu.online).length;

      await this.repository.finishRun(runId, {
        status: 'ok',
        total: collected.length,
        online,
        message:
          `${ports.join(', ')} — ${collected.length} ONU (${online} online)` +
          (opticalScanned > 0 ? `, redaman ${opticalScanned} ONU` : ''),
      });
      await this.repository.touchStatus(id, {
        connected: true,
        message: `Sinkron terakhir: ${collected.length} ONU (${online} online)`,
        identity,
        version,
      });
      await this.audit(actor, 'OLT_SYNCED', {
        id,
        ports,
        onu: collected.length,
        online,
        removed: saved.removed,
      });

      return {
        olt_id: id,
        identity,
        ports,
        onu_total: collected.length,
        onu_online: online,
        saved: saved.saved,
        removed: saved.removed,
        optical_scanned: opticalScanned,
        duration_ms: Date.now() - started,
      };
    } catch (error) {
      const message = this.describe(error);
      await this.repository.finishRun(runId, {
        status: 'error',
        total: 0,
        online: 0,
        message,
      });
      await this.repository.touchStatus(id, {
        connected: false,
        message,
        identity,
        version: null,
      });
      await this.audit(actor, 'OLT_SYNC_FAILED', { id, message });
      throw new ServiceUnavailableException(message);
    } finally {
      running.delete(id);
    }
  }

  async listOnus(filter: OltOnuFilter) {
    if (filter.oltId !== undefined) await this.requireDevice(filter.oltId);
    const size = Math.min(Math.max(Math.trunc(filter.size ?? 25), 1), 1000);
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const { rows, total, stats } = await this.repository.listOnus({ ...filter, page, size });
    return {
      page,
      size,
      total,
      stats,
      rows: rows.map((row) => ({
        ...row,
        online: Number(row.online) === 1,
        onu_mac: row.onu_mac ?? null,
        rx_power_onu: this.number(row.rx_power_onu),
        rx_power_olt: this.number(row.rx_power_olt),
        tx_power: this.number(row.tx_power),
        temperature: this.number(row.temperature),
        voltage: this.number(row.voltage),
        tx_bias: this.number(row.tx_bias),
        last_seen_at: new Date(row.last_seen_at).toISOString(),
      })),
    };
  }

  async listRuns(id: number) {
    await this.requireDevice(id);
    return { rows: await this.repository.listRuns(id) };
  }

  /**
   * Baca redaman dengan satu percobaan ulang.
   *
   * Perangkat EPON kadang menjawab tanpa baris RxPower saat perintah dikirim
   * beruntun cepat (sesudah empat `show onu info` besar). Percobaan kedua
   * setelah jeda pendek hampir selalu berhasil; kalau tetap kosong, ONU itu
   * memang tidak memberi data DDM dan tidak ditandai terbaca.
   */
  private async readOpticalWithRetry(
    adapter: { readOptical?: (portId: string, onuId: string) => Promise<OltOptical | null> },
    portId: string,
    onuId: string,
  ): Promise<OltOptical | null> {
    if (!adapter.readOptical) return null;
    const first = await adapter.readOptical(portId, onuId).catch(() => null);
    if (first && first.rxPowerOnu !== null) return first;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await adapter.readOptical(portId, onuId).catch(() => null);
    return second && second.rxPowerOnu !== null ? second : null;
  }

  // ===== bantuan internal =====

  private async requireDevice(id: number): Promise<OltDeviceRow> {
    const device = await this.repository.findDevice(id);
    if (!device) throw new NotFoundException('Perangkat OLT tidak ditemukan.');
    return device;
  }

  private assertVendor(vendor: string): void {
    if (!this.supportedVendors().includes(vendor)) {
      throw new BadRequestException(
        `Driver "${vendor}" belum tersedia. Pilihan yang ada: ${this.supportedVendors().join(', ')}.`,
      );
    }
  }

  private normalizePorts(raw?: string | null): string {
    const ports = this.splitPorts(raw);
    if (ports.length === 0) return '0/1';
    return ports.join(',');
  }

  private ports(device: OltDeviceRow): string[] {
    const ports = this.splitPorts(device.pon_ports);
    return ports.length > 0 ? ports : ['0/1'];
  }

  private splitPorts(raw?: string | null): string[] {
    return String(raw ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^\d{1,2}\/\d{1,2}$/.test(item));
  }

  private connection(device: OltDeviceRow): OltConnection {
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

  /** Ubah galat teknis menjadi kalimat yang bisa dibaca operator. */
  private describe(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message;
      if (/timed? ?out|ETIMEDOUT/i.test(message)) {
        return `Perangkat tidak menjawab: ${message}`;
      }
      return message;
    }
    return String(error);
  }

  private number(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async audit(
    actor: { userId: number; ip: string },
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .execute('INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)', [
        actor.userId,
        action,
        JSON.stringify(details),
        actor.ip,
      ])
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit ${action} gagal ditulis: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
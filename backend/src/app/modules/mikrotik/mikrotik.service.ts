import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { DatabaseService } from '../../database/database.service';
import { decryptSecret, encryptSecret } from './crypto';
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device.dto';
import {
  DEVICES_MIGRATION,
  MikrotikDeviceRow,
  MikrotikDevicesRepository,
} from './mikrotik-devices.repository';
import { MikrotikDevice, toMikrotikDevice } from './models/mikrotik-device.model';
import {
  FirewallAddressListDto,
  FirewallRuleDto,
  FirewallTable,
  HotspotUserDto,
  InterfaceUpdateDto,
  PppSecretDto,
  RouteDto,
  RouteRuleDto,
  UpdateFirewallAddressListDto,
  UpdateFirewallRuleDto,
  UpdateHotspotUserDto,
  UpdatePppSecretDto,
  UpdateRouteDto,
  UpdateRouteRuleDto,
} from './dto/mikrotik.dto';
import { filterLogs } from './log-filter';
import { RouterOsClient, RouterOsError, RouterOsRecord } from './routeros.client';

const num = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined): boolean => value === 'true' || value === 'yes';

/**
 * Uptime RouterOS → detik. Ada DUA format yang beredar dan keduanya harus
 * dikenali:
 *   RouterOS 7 : "2w6d2h27m48s"
 *   RouterOS 6 : "1w2d03:04:05"
 * Parser lama hanya mengenal format kedua, sehingga perangkat RouterOS 7
 * selalu melaporkan uptime 0 detik.
 */
export const uptimeSeconds = (value: string | undefined): number => {
  if (!value) return 0;
  const text = value.trim();

  const withClock = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):(\d+):(\d+))?$/.exec(text);
  if (withClock && (withClock[1] || withClock[2] || withClock[3])) {
    const [, w, d, h, m, s] = withClock;
    return num(w) * 604800 + num(d) * 86400 + num(h) * 3600 + num(m) * 60 + num(s);
  }

  const withSuffix = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (withSuffix && (withSuffix[1] || withSuffix[2] || withSuffix[3] || withSuffix[4] || withSuffix[5])) {
    const [, w, d, h, m, s] = withSuffix;
    return num(w) * 604800 + num(d) * 86400 + num(h) * 3600 + num(m) * 60 + num(s);
  }

  return 0;
};

export interface MikrotikTarget {
  device_id: number | null;
  device_name: string | null;
  source: 'device' | 'none';
  host: string;
  port: number;
  user: string;
  configured: boolean;
  gui_url: string;
  write_enabled: boolean;
}

// Bentuk perangkat yang dikirim ke UI. Definisi tunggal ada di model domain
// (models/mikrotik-device.model.ts); nama lama dipertahankan agar pemanggil
// yang sudah ada tidak berubah.
export type MikrotikDeviceView = MikrotikDevice;


/**
 * Penanda objek yang dibuat panel, supaya operator bisa menemukan dan
 * menghapusnya tanpa menebak. RouterOS 6.49 mendukung `comment` pada
 * /ip/pool dan /ppp/profile, TIDAK pada /ip/hotspot/user/profile.
 */
export const OWNER_COMMENT = 'created by jawara-isp';

@Injectable()
export class MikrotikService {
  private readonly logger = new Logger(MikrotikService.name);
  // Endpoint lama tidak menyebut perangkat; konteks disimpan per permintaan
  // supaya target()/client() tetap satu argumen dan aman untuk request paralel.
  private readonly als = new AsyncLocalStorage<{ deviceId?: number }>();
  private readonly targetCache = new Map<
    string,
    { at: number; value: MikrotikTarget & { password: string } }
  >();

  // Versi RouterOS per perangkat (6 vs 7): menentukan path menu policy routing.
  private readonly rosVersionCache = new Map<string, { at: number; value: '6' | '7' }>();

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly devices: MikrotikDevicesRepository,
  ) {}

  // ===== konteks perangkat =====
  runWithDevice<T>(deviceId: number | undefined, work: () => Promise<T>): Promise<T> {
    if (deviceId === undefined || deviceId === null) {
      return this.als.run({}, work);
    }
    const parsed = Number(deviceId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('Parameter device harus berupa id perangkat (angka bulat positif).');
    }
    return this.als.run({ deviceId: parsed }, work);
  }

  private view(row: MikrotikDeviceRow): MikrotikDeviceView {
    return toMikrotikDevice(row);
  }

  private fromRow(row: MikrotikDeviceRow): MikrotikTarget & { password: string } {
    const host = (row.host ?? '').trim();
    return {
      device_id: row.id,
      device_name: row.name,
      source: 'device',
      host,
      port: Number(row.api_port) || 1998,
      user: (row.api_user ?? '').trim(),
      password: decryptSecret(row.api_password, this.config.secretKey),
      configured: Boolean(host && (row.api_user ?? '').trim()),
      gui_url: (row.gui_url ?? '').trim() || (host ? `http://${host}` : ''),
      write_enabled: Number(row.write_enabled) === 1,
    };
  }

  // Host/port/user/password dibaca dari tabel `mikrotik_devices`. Bila tidak ada
  // perangkat aktif, target dikembalikan sebagai "belum dikonfigurasi" (host kosong).
  async target(deviceId?: number): Promise<MikrotikTarget & { password: string }> {
    const explicit = deviceId ?? this.als.getStore()?.deviceId;
    const cacheKey = explicit === undefined ? 'auto' : `d${explicit}`;
    const cached = this.targetCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5000) {
      return cached.value;
    }

    let value: (MikrotikTarget & { password: string }) | null = null;

    if (explicit !== undefined) {
      const row = await this.devices.find(explicit);
      if (!row) {
        throw new NotFoundException(`Perangkat MikroTik id ${explicit} tidak ditemukan.`);
      }
      if (Number(row.is_active) !== 1) {
        throw new ServiceUnavailableException(
          `Perangkat "${row.name}" sedang dinonaktifkan. Aktifkan dulu di MikroTik → Perangkat & Koneksi.`,
        );
      }
      value = this.fromRow(row);
    } else {
      const auto = (await this.devices.firstActive()) ?? null;
      if (auto) value = this.fromRow(auto);
    }

    if (!value) {
      value = {
        device_id: null,
        device_name: null,
        source: 'none',
        host: '',
        port: 1998,
        user: '',
        password: '',
        configured: false,
        gui_url: '',
        write_enabled: false,
      };
    }

    this.targetCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  forgetTargetCache(): void {
    this.targetCache.clear();
  }

  private async client(): Promise<RouterOsClient> {
    const target = await this.target();
    if (!target.configured) {
      throw new ServiceUnavailableException(
        target.source === 'device'
          ? `Host/user API perangkat "${target.device_name}" belum lengkap. Perbaiki di MikroTik → Perangkat & Koneksi.`
          : 'Host/user API MikroTik belum diisi. Tambahkan perangkat di MikroTik → Perangkat & Koneksi.',
      );
    }
    return new RouterOsClient({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      timeoutMs: 8000,
    });
  }

  // ===== CRUD perangkat =====
  async listDevices(): Promise<{
    ready: boolean;
    migration: string;
    default_device_id: number | null;
    rows: MikrotikDeviceView[];
  }> {
    if (!(await this.devices.hasTable())) {
      return { ready: false, migration: DEVICES_MIGRATION, default_device_id: null, rows: [] };
    }
    const rows = await this.devices.list();
    const auto = rows.find((row) => Number(row.is_active) === 1) ?? null;
    return {
      ready: true,
      migration: DEVICES_MIGRATION,
      default_device_id: auto ? auto.id : null,
      rows: rows.map((row) => this.view(row)),
    };
  }

  private async ensureDevicesTable(): Promise<void> {
    if (await this.devices.hasTable()) return;
    throw new ServiceUnavailableException(
      `Tabel mikrotik_devices belum ada. Jalankan migrasi ${DEVICES_MIGRATION} lebih dulu (setelah backup database).`,
    );
  }

  private sanitizeDeviceInput(dto: CreateDeviceDto | UpdateDeviceDto, current?: MikrotikDeviceRow) {
    const name = dto.name !== undefined ? dto.name.trim() : current?.name;
    const host = dto.host !== undefined ? dto.host.trim() : current?.host;
    const apiUser = dto.api_user !== undefined ? dto.api_user.trim() : current?.api_user;
    if (!name || !host || !apiUser) {
      throw new BadRequestException('Nama, host, dan user API perangkat wajib diisi.');
    }
    return { name, host, apiUser };
  }

  async createDevice(dto: CreateDeviceDto, actor: { userId: number; ip: string }) {
    await this.ensureDevicesTable();
    const { name, host, apiUser } = this.sanitizeDeviceInput(dto);
    if (await this.devices.findByName(name)) {
      throw new ConflictException(`Nama perangkat "${name}" sudah dipakai.`);
    }
    const id = await this.devices.create({
      name,
      host,
      api_user: apiUser,
      api_port: dto.api_port ?? 1998,
      api_password: dto.api_password ? encryptSecret(dto.api_password, this.config.secretKey) : '',
      gui_url: dto.gui_url?.trim() || null,
      description: dto.description?.trim() || null,
      write_enabled: dto.write_enabled === true,
      is_active: dto.is_active !== false,
    });
    await this.audit(actor, 'MIKROTIK_DEVICE_CREATED', { id, name, host, port: dto.api_port ?? 1998 });
    this.forgetTargetCache();
    const row = await this.devices.find(id);
    return row ? this.view(row) : null;
  }

  async updateDevice(id: number, dto: UpdateDeviceDto, actor: { userId: number; ip: string }) {
    await this.ensureDevicesTable();
    const current = await this.devices.find(id);
    if (!current) throw new NotFoundException(`Perangkat MikroTik id ${id} tidak ditemukan.`);
    const { name, host, apiUser } = this.sanitizeDeviceInput(dto, current);
    if (dto.name !== undefined && (await this.devices.findByName(name, id))) {
      throw new ConflictException(`Nama perangkat "${name}" sudah dipakai.`);
    }

    await this.devices.update(id, {
      name,
      host,
      api_user: apiUser,
      ...(dto.api_port !== undefined ? { api_port: dto.api_port } : {}),
      // Password kosong = jangan diubah (form tidak pernah menampilkan nilai asli).
      ...(dto.api_password
        ? { api_password: encryptSecret(dto.api_password, this.config.secretKey) }
        : {}),
      ...(dto.gui_url !== undefined ? { gui_url: dto.gui_url.trim() || null } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
      ...(dto.write_enabled !== undefined ? { write_enabled: dto.write_enabled } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
    });

    const changed = Object.keys(dto).filter(
      (key) => key !== 'api_password' && (dto as Record<string, unknown>)[key] !== undefined,
    );
    await this.audit(actor, 'MIKROTIK_DEVICE_UPDATED', {
      id,
      name,
      fields: dto.api_password ? [...changed, 'api_password'] : changed,
    });
    this.forgetTargetCache();
    const row = await this.devices.find(id);
    return row ? this.view(row) : null;
  }

  async deleteDevice(id: number, actor: { userId: number; ip: string }) {
    await this.ensureDevicesTable();
    const current = await this.devices.find(id);
    if (!current) throw new NotFoundException(`Perangkat MikroTik id ${id} tidak ditemukan.`);
    await this.devices.remove(id);
    await this.audit(actor, 'MIKROTIK_DEVICE_DELETED', { id, name: current.name, host: current.host });
    this.forgetTargetCache();
    return { deleted: true, id };
  }

  // Uji koneksi: satu perangkat, dua perintah, hasil disimpan ke kolom status.
  async testDevice(id: number, actor: { userId: number; ip: string }) {
    await this.ensureDevicesTable();
    const row = await this.devices.find(id);
    if (!row) throw new NotFoundException(`Perangkat MikroTik id ${id} tidak ditemukan.`);

    const target = this.fromRow(row);
    const base = { id: row.id, name: row.name, host: target.host, port: target.port };
    if (!target.configured) {
      const message = 'Host/user API belum lengkap.';
      await this.devices.touchStatus(id, { connected: false, message, identity: null });
      await this.audit(actor, 'MIKROTIK_DEVICE_TESTED', { id, connected: false });
      return { ...base, connected: false, message, identity: null, version: null, latency_ms: null };
    }

    const started = Date.now();
    try {
      const client = new RouterOsClient({
        host: target.host,
        port: target.port,
        user: target.user,
        password: target.password,
        timeoutMs: 8000,
      });
      const [identityResult, resourceResult] = await client.executeEach([
        ['/system/identity/print'],
        ['/system/resource/print'],
      ]);
      const identity = (identityResult.records[0] ?? {}).name ?? null;
      const resource = resourceResult.records[0] ?? {};
      const latency = Date.now() - started;
      await this.devices.touchStatus(id, { connected: true, message: 'Terhubung', identity });
      await this.audit(actor, 'MIKROTIK_DEVICE_TESTED', { id, connected: true, latency_ms: latency });
      this.forgetTargetCache();
      return {
        ...base,
        connected: true,
        message: 'Terhubung',
        identity,
        version: resource.version ?? null,
        board: resource['board-name'] ?? null,
        uptime: resource.uptime ?? null,
        latency_ms: latency,
      };
    } catch (error) {
      const message =
        error instanceof RouterOsError
          ? `${error.message}${error.detail ? ` (${error.detail})` : ''}`
          : error instanceof Error
            ? error.message
            : String(error);
      await this.devices.touchStatus(id, { connected: false, message, identity: null });
      await this.audit(actor, 'MIKROTIK_DEVICE_TESTED', { id, connected: false });
      this.forgetTargetCache();
      return { ...base, connected: false, message, identity: null, version: null, latency_ms: null };
    }
  }

  private translate(error: unknown): never {
    if (error instanceof RouterOsError) {
      if (error.kind === 'trap') {
        throw new BadRequestException(`MikroTik menolak perintah: ${error.detail ?? error.message}`);
      }
      const suffix = error.detail ? ` (${error.detail})` : '';
      throw new ServiceUnavailableException(
        `${error.message}${suffix}. Periksa alamat API, user/password, dan izin API user.`,
      );
    }
    throw new BadGatewayException(
      `Gagal membaca data dari MikroTik: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private async read(
    path: string,
    options: { query?: string[] } = {},
  ): Promise<RouterOsRecord[]> {
    const client = await this.client();
    const words = [path, ...(options.query ?? [])];
    try {
      const result = await client.execute([words]);
      return result.records;
    } catch (error) {
      this.logger.warn(`MikroTik ${path} gagal: ${error instanceof Error ? error.message : String(error)}`);
      this.translate(error);
    }
  }

  // Banyak perintah dalam SATU koneksi: menghemat login dan menjaga urutan.
  private async readMany(paths: string[]): Promise<RouterOsRecord[][]> {
    const client = await this.client();
    try {
      const results = await client.executeEach(paths.map((path) => [path]));
      return results.map((result) => result.records);
    } catch (error) {
      this.logger.warn(
        `MikroTik ${paths.join(', ')} gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.translate(error);
    }
  }

  private async write(command: string, attributes: Record<string, string | undefined>, label: string) {
    const target = await this.target();
    if (!target.write_enabled) {
      throw new ForbiddenException(
        'Tulis ke perangkat MikroTik dinonaktifkan. Aktifkan mode tulis (write_enabled) untuk perangkat ini di MikroTik → Perangkat & Koneksi.',
      );
    }
    const client = await this.client();
    const words = [command];
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null) continue;
      words.push(`=${key}=${value}`);
    }
    try {
      await client.execute([words]);
      this.logger.log(`MikroTik ${label}: ${command}`);
    } catch (error) {
      this.translate(error);
    }
  }

  async audit(actor: { userId: number; ip: string }, action: string, details: Record<string, unknown>) {
    await this.db
      .execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [actor.userId, action, JSON.stringify(details), actor.ip],
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit ${action} gagal ditulis: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // ===== baca: ringkasan =====
  async status() {
    const target = await this.target();
    const base = {
      device_id: target.device_id,
      device_name: target.device_name,
      source: target.source,
      host: target.host,
      port: target.port,
      gui_url: target.gui_url,
      write_enabled: target.write_enabled,
      checked_at: new Date().toISOString(),
    };

    if (!target.configured) {
      return {
        ...base,
        configured: false,
        connected: false,
        message:
          target.source === 'device'
            ? `Host/user API perangkat "${target.device_name}" belum lengkap.`
            : 'Belum ada perangkat MikroTik aktif. Tambahkan di MikroTik → Perangkat & Koneksi.',
      };
    }

    try {
      const client = await this.client();
      const [identityResult, resourceResult, boardResult, interfaceResult] =
        await client.executeEach([
          ['/system/identity/print'],
          ['/system/resource/print'],
          ['/system/routerboard/print'],
          ['/interface/print'],
        ]);
      const identity = identityResult.records[0] ?? {};
      const resource = resourceResult.records[0] ?? {};
      const board = boardResult.records[0] ?? {};
      const interfaces = interfaceResult.records;

      return {
        ...base,
        configured: true,
        connected: true,
        identity: identity.name ?? null,
        version: resource.version ?? null,
        board: resource['board-name'] ?? board['board-name'] ?? null,
        uptime: resource.uptime ?? null,
        cpu_load: num(resource['cpu-load']),
        memory_total_mb: Math.round(num(resource['total-memory']) / 1048576),
        memory_free_mb: Math.round(num(resource['free-memory']) / 1048576),
        interfaces: {
          total: interfaces.length,
          running: interfaces.filter((row) => row.running === 'true').length,
          disabled: interfaces.filter((row) => row.disabled === 'true').length,
        },
      };
    } catch (error) {
      const message =
        error instanceof RouterOsError
          ? `${error.message}${error.detail ? ` (${error.detail})` : ''}`
          : error instanceof Error
            ? error.message
            : String(error);
      return { ...base, configured: true, connected: false, message };
    }
  }

  async resources() {
    const [resourceRows, identityRows, boardRows] = await this.readMany([
      '/system/resource/print',
      '/system/identity/print',
      '/system/routerboard/print',
    ]).catch(async () => {
      // /system/routerboard/print tidak ada di perangkat non-RouterBOARD (CHR/x86).
      const [resourceOnly, identityOnly] = await this.readMany([
        '/system/resource/print',
        '/system/identity/print',
      ]);
      return [resourceOnly, identityOnly, [] as RouterOsRecord[]];
    });

    const row = resourceRows[0] ?? {};
    const board = boardRows[0] ?? {};
    return {
      identity: identityRows[0]?.name ?? null,
      version: row.version ?? null,
      board: row['board-name'] ?? board['board-name'] ?? board.model ?? null,
      architecture: row['architecture-name'] ?? null,
      uptime: row.uptime ?? null,
      uptime_seconds: uptimeSeconds(row.uptime),
      cpu: row.cpu ?? null,
      cpu_count: num(row['cpu-count'], 1),
      cpu_load: num(row['cpu-load']),
      memory_total_mb: Math.round(num(row['total-memory']) / 1048576),
      memory_free_mb: Math.round(num(row['free-memory']) / 1048576),
      memory_used_mb: Math.round(
        (num(row['total-memory']) - num(row['free-memory'])) / 1048576,
      ),
      hdd_total_mb: Math.round(num(row['total-hdd-space']) / 1048576),
      hdd_free_mb: Math.round(num(row['free-hdd-space']) / 1048576),
      load_average: row['load-average'] ?? null,
      raw: row,
    };
  }

  async interfaces() {
    const rows = await this.read('/interface/print');
    return rows
      .map((row) => ({
        id: row['.id'] ?? '',
        name: row.name ?? '',
        type: row.type ?? '',
        mtu: num(row.mtu),
        mac_address: row['mac-address'] ?? null,
        running: row.running === undefined ? null : bool(row.running),
        disabled: bool(row.disabled),
        comment: row.comment ?? '',
        tx_bytes: num(row['tx-byte']),
        rx_bytes: num(row['rx-byte']),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Traffic satu interface saat ini (read-only).
  //
  // `/interface/monitor-traffic` bersifat streaming; dengan `=once=` RouterOS
  // mengirim SATU rekaman lalu menutup perintah, sehingga aman untuk polling.
  // Nilai rx/tx di sini adalah bit per detik (bukan byte kumulatif).
  async interfaceTraffic(name: string) {
    // Pastikan interface benar-benar ada: sekaligus mencegah nama sembarang
    // dikirim ke router, dan memberi galat 404 yang jelas.
    const found = await this.read('/interface/print', { query: [`?name=${name}`] });
    if (found.length === 0) {
      throw new NotFoundException(`Interface "${name}" tidak ada di perangkat ini.`);
    }
    const row = found[0];
    const disabled = bool(row.disabled);

    if (disabled) {
      // monitor-traffic menolak interface nonaktif; jawab dengan nol, bukan galat.
      return {
        name,
        rx_bps: 0,
        tx_bps: 0,
        rx_pps: 0,
        tx_pps: 0,
        running: false,
        disabled: true,
        rx_bytes: num(row['rx-byte']),
        tx_bytes: num(row['tx-byte']),
        sampled_at: new Date().toISOString(),
      };
    }

    const client = await this.client();
    let record: RouterOsRecord = {};
    try {
      const result = await client.execute([
        ['/interface/monitor-traffic', `=interface=${name}`, '=once='],
      ]);
      record = result.records[0] ?? {};
    } catch (error) {
      this.logger.warn(
        `monitor-traffic ${name} gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.translate(error);
    }

    return {
      name,
      rx_bps: num(record['rx-bits-per-second']),
      tx_bps: num(record['tx-bits-per-second']),
      rx_pps: num(record['rx-packets-per-second']),
      tx_pps: num(record['tx-packets-per-second']),
      running: row.running === undefined ? null : bool(row.running),
      disabled: false,
      rx_bytes: num(row['rx-byte']),
      tx_bytes: num(row['tx-byte']),
      sampled_at: new Date().toISOString(),
    };
  }

  async hotspotServers() {
    const rows = await this.read('/ip/hotspot/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      name: row.name ?? '',
      interface: row.interface ?? '',
      profile: row.profile ?? '',
      address_pool: row['address-pool'] ?? null,
      disabled: bool(row.disabled),
      idle_timeout: row['idle-timeout'] ?? null,
    }));
  }

  async hotspotProfiles() {
    const rows = await this.read('/ip/hotspot/profile/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      name: row.name ?? '',
      hotspot_address: row['hotspot-address'] ?? null,
      dns_name: row['dns-name'] ?? null,
      login_by: row['login-by'] ?? null,
      radius: bool(row['use-radius']),
      radius_accounting: bool(row['radius-accounting']),
    }));
  }

  // Profil USER hotspot (/ip/hotspot/user/profile) — di sinilah rate-limit dan
  // shared-users berada. Berbeda dari hotspotProfiles() yang membaca profil
  // server (/ip/hotspot/profile) berisi setelan RADIUS.
  async hotspotUserProfiles() {
    const rows = await this.read('/ip/hotspot/user/profile/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      name: row.name ?? '',
      rate_limit: row['rate-limit'] ?? null,
      shared_users: row['shared-users'] ?? null,
      session_timeout: row['session-timeout'] ?? null,
      keepalive_timeout: row['keepalive-timeout'] ?? null,
      status_autorefresh: row['status-autorefresh'] ?? null,
      add_mac_cookie: row['add-mac-cookie'] === undefined ? null : bool(row['add-mac-cookie']),
    }));
  }

  async hotspotUsers(query: { search?: string; profile?: string; server?: string; disabled?: 'yes' | 'no' }) {
    const filters: string[] = [];
    if (query.disabled) filters.push(`?disabled=${query.disabled}`);
    const rows = await this.read('/ip/hotspot/user/print', { query: filters });
    const needle = query.search?.trim().toLowerCase();

    return rows
      .map((row) => ({
        id: row['.id'] ?? '',
        name: row.name ?? '',
        password: row.password ?? '',
        profile: row.profile ?? 'default',
        server: row.server ?? 'all',
        limit_uptime: row['limit-uptime'] ?? '',
        uptime: row.uptime ?? '',
        bytes_in: num(row['bytes-in']),
        bytes_out: num(row['bytes-out']),
        comment: row.comment ?? '',
        disabled: bool(row.disabled),
      }))
      .filter((row) => {
        if (query.profile && row.profile !== query.profile) return false;
        if (query.server && row.server !== query.server) return false;
        if (!needle) return true;
        return `${row.name} ${row.comment} ${row.profile}`.toLowerCase().includes(needle);
      });
  }

  async hotspotActive() {
    const rows = await this.read('/ip/hotspot/active/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      user: row.user ?? '',
      address: row.address ?? '',
      mac_address: row['mac-address'] ?? null,
      uptime: row.uptime ?? '',
      bytes_in: num(row['bytes-in']),
      bytes_out: num(row['bytes-out']),
      server: row.server ?? '',
    }));
  }

  async hotspotUserById(id: string): Promise<RouterOsRecord | null> {
    const rows = await this.read('/ip/hotspot/user/print', { query: [`?.id=${id}`] });
    return rows[0] ?? null;
  }

  async createHotspotUser(dto: HotspotUserDto, actor: { userId: number; ip: string }) {
    await this.write(
      '/ip/hotspot/user/add',
      {
        name: dto.name,
        password: dto.password ?? dto.name,
        profile: dto.profile,
        server: dto.server,
        'limit-uptime': dto.limit_uptime,
        comment: dto.comment,
        disabled: dto.disabled ? 'yes' : 'no',
      },
      'hotspot user add',
    );
    await this.audit(actor, 'MIKROTIK_HOTSPOT_USER_CREATED', { name: dto.name, profile: dto.profile });
    return { ok: true, name: dto.name };
  }

  async updateHotspotUser(id: string, dto: UpdateHotspotUserDto, actor: { userId: number; ip: string }) {
    await this.write(
      '/ip/hotspot/user/set',
      {
        numbers: id,
        password: dto.password,
        profile: dto.profile,
        'limit-uptime': dto.limit_uptime,
        comment: dto.comment,
        disabled: dto.disabled === undefined ? undefined : dto.disabled ? 'yes' : 'no',
      },
      'hotspot user set',
    );
    await this.audit(actor, 'MIKROTIK_HOTSPOT_USER_UPDATED', { id, fields: Object.keys(dto) });
    return { ok: true, id };
  }

  async deleteHotspotUser(id: string, actor: { userId: number; ip: string }) {
    const name = await this.findHotspotUserName(id);
    await this.write('/ip/hotspot/user/remove', { numbers: id }, 'hotspot user remove');
    if (name) {
      await this.removeActiveSessions('/ip/hotspot/active', 'user', name);
    }
    await this.audit(actor, 'MIKROTIK_HOTSPOT_USER_DELETED', { id });
    return { ok: true, id };
  }

  // Nama user hotspot dari `.id` sebelum barisnya dihapus (untuk putus sesi aktif).
  private async findHotspotUserName(id: string): Promise<string | null> {
    const rows = await this.read('/ip/hotspot/user/print');
    const row = rows.find((entry) => entry['.id'] === id);
    return row?.name ? String(row.name) : null;
  }

  async pppActive() {
    const rows = await this.read('/ppp/active/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      name: row.name ?? '',
      service: row.service ?? '',
      address: row.address ?? '',
      caller_id: row['caller-id'] ?? '',
      uptime: row.uptime ?? '',
      encoding: row.encoding ?? '',
    }));
  }

  async pppSecrets(query: { search?: string; service?: string }) {
    const rows = await this.read('/ppp/secret/print');
    const needle = query.search?.trim().toLowerCase();
    return rows
      .map((row) => ({
        id: row['.id'] ?? '',
        name: row.name ?? '',
        password: row.password ?? '',
        service: row.service ?? 'any',
        profile: row.profile ?? 'default',
        remote_address: row['remote-address'] ?? '',
        local_address: row['local-address'] ?? '',
        comment: row.comment ?? '',
        disabled: bool(row.disabled),
      }))
      .filter((row) => {
        if (query.service && row.service !== query.service) return false;
        if (!needle) return true;
        return `${row.name} ${row.comment} ${row.remote_address}`.toLowerCase().includes(needle);
      });
  }

  async pppProfiles() {
    const rows = await this.read('/ppp/profile/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      name: row.name ?? '',
      local_address: row['local-address'] ?? null,
      remote_address: row['remote-address'] ?? null,
      rate_limit: row['rate-limit'] ?? null,
      dns_server: row['dns-server'] ?? null,
      use_radius: row['use-radius'] === undefined ? null : bool(row['use-radius']),
    }));
  }

  async createPppSecret(dto: PppSecretDto, actor: { userId: number; ip: string }) {
    await this.write(
      '/ppp/secret/add',
      {
        name: dto.name,
        password: dto.password ?? dto.name,
        service: dto.service ?? 'any',
        profile: dto.profile,
        'remote-address': dto.remote_address,
        comment: dto.comment,
        disabled: dto.disabled ? 'yes' : 'no',
      },
      'ppp secret add',
    );
    await this.audit(actor, 'MIKROTIK_PPP_SECRET_CREATED', { name: dto.name, service: dto.service });
    return { ok: true, name: dto.name };
  }

  async updatePppSecret(id: string, dto: UpdatePppSecretDto, actor: { userId: number; ip: string }) {
    await this.write(
      '/ppp/secret/set',
      {
        numbers: id,
        password: dto.password,
        service: dto.service,
        profile: dto.profile,
        'remote-address': dto.remote_address,
        comment: dto.comment,
        disabled: dto.disabled === undefined ? undefined : dto.disabled ? 'yes' : 'no',
      },
      'ppp secret set',
    );
    await this.audit(actor, 'MIKROTIK_PPP_SECRET_UPDATED', { id, fields: Object.keys(dto) });
    return { ok: true, id };
  }

  async deletePppSecret(id: string, actor: { userId: number; ip: string }) {
    const name = await this.findPppSecretName(id);
    await this.write('/ppp/secret/remove', { numbers: id }, 'ppp secret remove');
    if (name) {
      await this.removeActiveSessions('/ppp/active', 'name', name);
    }
    await this.audit(actor, 'MIKROTIK_PPP_SECRET_DELETED', { id });
    return { ok: true, id };
  }

  // Nama PPP secret dari `.id` sebelum barisnya dihapus (untuk putus sesi aktif).
  private async findPppSecretName(id: string): Promise<string | null> {
    const rows = await this.read('/ppp/secret/print');
    const row = rows.find((entry) => entry['.id'] === id);
    return row?.name ? String(row.name) : null;
  }

  // Putus semua sesi aktif yang cocok di menu aktif (print → remove by .id).
  private async removeActiveSessions(
    menu: '/ppp/active' | '/ip/hotspot/active',
    nameField: 'name' | 'user',
    value: string,
  ): Promise<void> {
    const rows = await this.read(`${menu}/print`);
    for (const row of rows) {
      if (row[nameField] === value && row['.id']) {
        await this.write(`${menu}/remove`, { numbers: row['.id'] }, `${menu} remove ${value}`);
      }
    }
  }

  async routingRoutes() {
    const rows = await this.read('/ip/route/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      dst_address: row['dst-address'] ?? '',
      gateway: row.gateway ?? '',
      distance: num(row.distance, 1),
      active: bool(row.active),
      static: bool(row.static),
      disabled: bool(row.disabled),
      comment: row.comment ?? '',
    }));
  }

  async routingNeighbors() {
    // ROS 6: daftar tetangga MNDP ada di /ip/neighbor; /routing/neighbor tidak
    // tersedia di semua versi, jadi dicoba berurutan.
    const rows = await this.read('/ip/neighbor/print').catch(() =>
      this.read('/routing/neighbor/print'),
    );
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      interface: row.interface ?? '',
      address: row.address ?? '',
      address4: row['address4'] ?? '',
      identity: row.identity ?? '',
      platform: row.platform ?? '',
      version: row.version ?? '',
      uptime: row.uptime ?? '',
    }));
  }

  async routingArp() {
    const rows = await this.read('/ip/arp/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      address: row.address ?? '',
      mac_address: row['mac-address'] ?? '',
      interface: row.interface ?? '',
      dynamic: bool(row.dynamic),
      disabled: bool(row.disabled),
      comment: row.comment ?? '',
    }));
  }

  /**
   * Log aktivitas perangkat (`/log/print`) — baca-saja.
   *
   * Difilter di sisi panel, bukan lewat query API: sintaks query RouterOS
   * berbeda antar versi dan `?#` (regex) tidak konsisten di ROS 6. Satu perintah
   * print lalu disaring lokal jauh lebih dapat diandalkan, dan isi log perangkat
   * memang kecil (default 1000 baris).
   */
  async logs(query: { topics?: string; search?: string; limit?: number } = {}) {
    const target = await this.target();
    const records = await this.read('/log/print');
    return { device_id: target.device_id, ...filterLogs(records, query) };
  }

  async setInterfaceDisabled(name: string, dto: InterfaceUpdateDto, actor: { userId: number; ip: string }) {
    if (!name) throw new BadRequestException('Nama interface wajib diisi');
    await this.write(
      '/interface/set',
      { numbers: name, disabled: dto.disabled ? 'yes' : 'no' },
      `interface ${name} ${dto.disabled ? 'disable' : 'enable'}`,
    );
    await this.audit(actor, 'MIKROTIK_INTERFACE_TOGGLED', { interface: name, disabled: dto.disabled });
    return { ok: true, name, disabled: dto.disabled };
  }

  async findInterface(name: string): Promise<boolean> {
    const rows = await this.read('/interface/print');
    const found = rows.some((row) => row.name === name);
    if (!found) throw new NotFoundException(`Interface "${name}" tidak ditemukan di MikroTik`);
    return true;
  }

  // ===== firewall =====

  // Versi RouterOS perangkat target; dipakai untuk memilih path menu yang beda
  // antara RouterOS 6 dan 7 (mis. policy routing /ip route rule vs /routing rule).
  private async rosVersion(): Promise<'6' | '7'> {
    const target = await this.target();
    const key = `${target.host}:${target.port}`;
    const cached = this.rosVersionCache.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const rows = await this.read('/system/resource/print');
    const value: '6' | '7' = String(rows[0]?.version ?? '').startsWith('7') ? '7' : '6';
    this.rosVersionCache.set(key, { at: Date.now(), value });
    return value;
  }

  private firewallView(row: RouterOsRecord) {
    return {
      id: row['.id'] ?? '',
      chain: row.chain ?? '',
      action: row.action ?? '',
      protocol: row.protocol ?? '',
      src_address: row['src-address'] ?? '',
      dst_address: row['dst-address'] ?? '',
      src_port: row['src-port'] ?? '',
      dst_port: row['dst-port'] ?? '',
      in_interface: row['in-interface'] ?? '',
      out_interface: row['out-interface'] ?? '',
      connection_state: row['connection-state'] ?? '',
      to_addresses: row['to-addresses'] ?? '',
      to_ports: row['to-ports'] ?? '',
      new_connection_mark: row['new-connection-mark'] ?? '',
      new_routing_mark: row['new-routing-mark'] ?? '',
      new_packet_mark: row['new-packet-mark'] ?? '',
      comment: row.comment ?? '',
      disabled: bool(row.disabled),
      bytes: num(row.bytes),
      packets: num(row.packets),
    };
  }

  // DTO (snake_case, boleh sebagian) → atribut RouterOS (kebab-case). `write`
  // melewati nilai kosong, jadi kolom yang tidak diisi tidak ikut dikirim.
  // `disabled` diurus terpisah (string yes/no), jadi dikeluarkan dari mapping
  // agar tipe nilainya tetap string, bukan string | boolean.
  private firewallAttributes(dto: FirewallRuleDto | UpdateFirewallRuleDto): Record<string, string | undefined> {
    const mapping: Array<[string, Exclude<keyof FirewallRuleDto, 'disabled'>]> = [
      ['chain', 'chain'],
      ['action', 'action'],
      ['protocol', 'protocol'],
      ['src-address', 'src_address'],
      ['dst-address', 'dst_address'],
      ['src-port', 'src_port'],
      ['dst-port', 'dst_port'],
      ['in-interface', 'in_interface'],
      ['out-interface', 'out_interface'],
      ['connection-state', 'connection_state'],
      ['src-mac-address', 'src_mac'],
      ['to-addresses', 'to_addresses'],
      ['to-ports', 'to_ports'],
      ['new-connection-mark', 'new_connection_mark'],
      ['new-routing-mark', 'new_routing_mark'],
      ['new-packet-mark', 'new_packet_mark'],
      ['comment', 'comment'],
      ['place-before', 'place_before'],
    ];
    const attrs: Record<string, string | undefined> = {};
    for (const [rosKey, dtoKey] of mapping) {
      const value = dto[dtoKey];
      if (value !== undefined && value !== null) attrs[rosKey] = value;
    }
    if (dto.disabled !== undefined) attrs.disabled = dto.disabled ? 'yes' : 'no';
    return attrs;
  }

  async firewallRules(table: FirewallTable) {
    const rows = await this.read(`/ip/firewall/${table}/print`);
    return rows.map((row) => this.firewallView(row));
  }

  async createFirewallRule(table: FirewallTable, dto: FirewallRuleDto, actor: { userId: number; ip: string }) {
    await this.write(`/ip/firewall/${table}/add`, this.firewallAttributes(dto), `firewall ${table} add`);
    await this.audit(actor, 'MIKROTIK_FIREWALL_RULE_CREATED', { table, chain: dto.chain, action: dto.action });
    return { ok: true, table, chain: dto.chain };
  }

  async updateFirewallRule(table: FirewallTable, id: string, dto: UpdateFirewallRuleDto, actor: { userId: number; ip: string }) {
    await this.write(`/ip/firewall/${table}/set`, { numbers: id, ...this.firewallAttributes(dto) }, `firewall ${table} set`);
    await this.audit(actor, 'MIKROTIK_FIREWALL_RULE_UPDATED', { table, id, fields: Object.keys(dto) });
    return { ok: true, table, id };
  }

  async deleteFirewallRule(table: FirewallTable, id: string, actor: { userId: number; ip: string }) {
    await this.write(`/ip/firewall/${table}/remove`, { numbers: id }, `firewall ${table} remove`);
    await this.audit(actor, 'MIKROTIK_FIREWALL_RULE_DELETED', { table, id });
    return { ok: true, table, id };
  }

  async firewallAddressLists() {
    const rows = await this.read('/ip/firewall/address-list/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      list: row.list ?? '',
      address: row.address ?? '',
      comment: row.comment ?? '',
      dynamic: bool(row.dynamic),
      disabled: bool(row.disabled),
    }));
  }

  async createFirewallAddressList(dto: FirewallAddressListDto, actor: { userId: number; ip: string }) {
    await this.write(
      '/ip/firewall/address-list/add',
      {
        list: dto.list,
        address: dto.address,
        comment: dto.comment,
        disabled: dto.disabled ? 'yes' : 'no',
      },
      'firewall address-list add',
    );
    await this.audit(actor, 'MIKROTIK_FIREWALL_ADDRLIST_CREATED', { list: dto.list, address: dto.address });
    return { ok: true, list: dto.list, address: dto.address };
  }

  async updateFirewallAddressList(id: string, dto: UpdateFirewallAddressListDto, actor: { userId: number; ip: string }) {
    await this.write(
      '/ip/firewall/address-list/set',
      {
        numbers: id,
        list: dto.list,
        address: dto.address,
        comment: dto.comment,
        disabled: dto.disabled === undefined ? undefined : dto.disabled ? 'yes' : 'no',
      },
      'firewall address-list set',
    );
    await this.audit(actor, 'MIKROTIK_FIREWALL_ADDRLIST_UPDATED', { id, fields: Object.keys(dto) });
    return { ok: true, id };
  }

  async deleteFirewallAddressList(id: string, actor: { userId: number; ip: string }) {
    await this.write('/ip/firewall/address-list/remove', { numbers: id }, 'firewall address-list remove');
    await this.audit(actor, 'MIKROTIK_FIREWALL_ADDRLIST_DELETED', { id });
    return { ok: true, id };
  }

  // ===== route (/ip route) =====

  async listRoutes() {
    const rows = await this.read('/ip/route/print');
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      dst_address: row['dst-address'] ?? '',
      gateway: row.gateway ?? '',
      distance: num(row.distance, 1),
      scope: num(row.scope),
      target_scope: num(row['target-scope']),
      routing_table: row['routing-table'] ?? '',
      routing_mark: row['routing-mark'] ?? '',
      pref_src: row['pref-src'] ?? '',
      comment: row.comment ?? '',
      active: bool(row.active),
      static: bool(row.static),
      dynamic: bool(row.dynamic),
      connect: bool(row.connect),
      disabled: bool(row.disabled),
    }));
  }

  private routeAttributes(dto: RouteDto | UpdateRouteDto): Record<string, string | undefined> {
    return {
      'dst-address': dto.dst_address,
      gateway: dto.gateway,
      distance: dto.distance,
      scope: dto.scope,
      'target-scope': dto.target_scope,
      'routing-table': dto.routing_table,
      'routing-mark': dto.routing_mark,
      comment: dto.comment,
      disabled: dto.disabled === undefined ? undefined : dto.disabled ? 'yes' : 'no',
    };
  }

  async createRoute(dto: RouteDto, actor: { userId: number; ip: string }) {
    await this.write('/ip/route/add', this.routeAttributes(dto), 'route add');
    await this.audit(actor, 'MIKROTIK_ROUTE_CREATED', { dst_address: dto.dst_address, gateway: dto.gateway });
    return { ok: true, dst_address: dto.dst_address };
  }

  async updateRoute(id: string, dto: UpdateRouteDto, actor: { userId: number; ip: string }) {
    await this.write('/ip/route/set', { numbers: id, ...this.routeAttributes(dto) }, 'route set');
    await this.audit(actor, 'MIKROTIK_ROUTE_UPDATED', { id, fields: Object.keys(dto) });
    return { ok: true, id };
  }

  async deleteRoute(id: string, actor: { userId: number; ip: string }) {
    await this.write('/ip/route/remove', { numbers: id }, 'route remove');
    await this.audit(actor, 'MIKROTIK_ROUTE_DELETED', { id });
    return { ok: true, id };
  }

  // ===== route rule (policy routing) =====
  // RouterOS 6 memakai /ip/route/rule, RouterOS 7 memakai /routing/rule.

  private routeRuleMenu(version: '6' | '7'): string {
    return version === '7' ? '/routing/rule' : '/ip/route/rule';
  }

  private routeRuleAttributes(dto: RouteRuleDto | UpdateRouteRuleDto, version: '6' | '7'): Record<string, string | undefined> {
    return {
      'src-address': dto.src_address,
      'dst-address': dto.dst_address,
      table: dto.table,
      // routing-mark hanya ada di /ip route rule (ROS6); di ROS7 ditolak.
      'routing-mark': version === '6' ? dto.routing_mark : undefined,
      action: dto.action,
      comment: dto.comment,
      disabled: dto.disabled === undefined ? undefined : dto.disabled ? 'yes' : 'no',
    };
  }

  async listRouteRules() {
    const version = await this.rosVersion();
    const rows = await this.read(`${this.routeRuleMenu(version)}/print`);
    return rows.map((row) => ({
      id: row['.id'] ?? '',
      src_address: row['src-address'] ?? '',
      dst_address: row['dst-address'] ?? '',
      table: row.table ?? '',
      routing_mark: row['routing-mark'] ?? '',
      action: row.action ?? '',
      comment: row.comment ?? '',
      disabled: bool(row.disabled),
    }));
  }

  async createRouteRule(dto: RouteRuleDto, actor: { userId: number; ip: string }) {
    const version = await this.rosVersion();
    await this.write(`${this.routeRuleMenu(version)}/add`, this.routeRuleAttributes(dto, version), 'route rule add');
    await this.audit(actor, 'MIKROTIK_ROUTE_RULE_CREATED', { table: dto.table });
    return { ok: true, table: dto.table };
  }

  async updateRouteRule(id: string, dto: UpdateRouteRuleDto, actor: { userId: number; ip: string }) {
    const version = await this.rosVersion();
    await this.write(`${this.routeRuleMenu(version)}/set`, { numbers: id, ...this.routeRuleAttributes(dto, version) }, 'route rule set');
    await this.audit(actor, 'MIKROTIK_ROUTE_RULE_UPDATED', { id, fields: Object.keys(dto) });
    return { ok: true, id };
  }

  async deleteRouteRule(id: string, actor: { userId: number; ip: string }) {
    const version = await this.rosVersion();
    await this.write(`${this.routeRuleMenu(version)}/remove`, { numbers: id }, 'route rule remove');
    await this.audit(actor, 'MIKROTIK_ROUTE_RULE_DELETED', { id });
    return { ok: true, id };
  }

  /**
   * Menyiapkan profil lokal di perangkat untuk sebuah Group Profile panel.
   *
   * Parent queue TIDAK bisa dikirim lewat RADIUS — hanya bisa menempel pada
   * profil lokal. Karena itu grup yang memakai parent queue wajib punya profil
   * dengan nama yang sama di perangkat.
   *
   * Rate-limit sengaja tidak ditulis: pada Model A nilai itu datang dari
   * `radgroupreply`, sehingga angka di RADIUS yang menang dan bisa dibuktikan.
   *
   * Tidak pernah melempar saat perangkat tidak bisa ditulis: pemanggil tetap
   * menyimpan grup (database sumber kebenaran) dan menampilkan perintah manual.
   */
  async provisionGroupProfile(input: {
    deviceId: number;
    type: 'hotspot' | 'ppp';
    name: string;
    /** Nama lama bila profil di-rename (rename di tempat, bukan diduplikasi). */
    oldName?: string | null;
    /** Nama pool lama untuk mode router-pool saat rename. */
    oldPoolName?: string | null;
    parentQueue?: string | null;
    poolName?: string | null;
    /** Bila diisi, panel membuat IP pool ini di router sebelum profilnya. */
    createPool?: { name: string; rangeStart: string; rangeEnd: string } | null;
    /** Gateway sesi PPP (local-address). Wajib untuk PPP + group-pool. */
    localAddress?: string | null;
    dnsPrimary?: string | null;
    dnsSecondary?: string | null;
    sharedUsers?: number | null;
  }): Promise<GroupProvisionResult> {
    const path = input.type === 'hotspot' ? '/ip/hotspot/user/profile' : '/ppp/profile';
    const attributes = this.groupProfileAttributes(input);

    // Perintah manual harus mencerminkan URUTAN sebenarnya: pool dulu, baru
    // profil — profil PPP yang menunjuk pool belum ada akan ditolak RouterOS.
    const poolCommand = input.createPool
      ? [
          '/ip/pool/add',
          `name=${input.createPool.name}`,
          `ranges=${input.createPool.rangeStart}-${input.createPool.rangeEnd}`,
          `comment=${OWNER_COMMENT}`,
        ].join(' ')
      : '';
    const profileCommand = [`${path}/add`, `name=${input.name}`, ...Object.entries(attributes).map(([k, v]) => `${k}=${v}`)].join(' ');
    const command = poolCommand ? `${poolCommand} ; ${profileCommand}` : profileCommand;

    const row = await this.devices.find(input.deviceId);
    if (!row) {
      return { ok: false, action: 'skipped', device: `#${input.deviceId}`, message: 'Perangkat tidak ditemukan.', command };
    }
    const target = this.fromRow(row);
    if (!target.configured) {
      return { ok: false, action: 'skipped', device: row.name, message: 'Host/user API perangkat belum lengkap.', command };
    }
    if (!target.write_enabled) {
      return {
        ok: false,
        action: 'skipped',
        device: row.name,
        message: 'Tulis ke perangkat dinonaktifkan untuk perangkat ini. Jalankan perintah di bawah manual.',
        command,
      };
    }

    const client = new RouterOsClient({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      timeoutMs: 8000,
    });

    try {
      let poolNote = '';
      if (input.createPool) {
        const ranges = `${input.createPool.rangeStart}-${input.createPool.rangeEnd}`;
        const poolName = input.createPool.name;
        const renamePoolFrom =
          input.oldPoolName && input.oldPoolName !== poolName ? input.oldPoolName : null;

        let poolId: string | undefined;
        if (renamePoolFrom) {
          // Rename pool lama buatan panel ke nama baru — jangan buat pool kedua.
          const oldPool = (await client.execute([['/ip/pool/print', `?name=${renamePoolFrom}`]])).records ?? [];
          poolId = oldPool[0]?.['.id'];
          if (poolId) {
            await client.execute([[
              '/ip/pool/set',
              `=.id=${poolId}`,
              `=name=${poolName}`,
              `=ranges=${ranges}`,
              `=comment=${OWNER_COMMENT}`,
            ]]);
            poolNote = ` Pool "${renamePoolFrom}" diubah nama menjadi "${poolName}".`;
          }
        }
        if (!poolId) {
          const found = (await client.execute([['/ip/pool/print', `?name=${poolName}`]])).records ?? [];
          poolId = found[0]?.['.id'];
          if (poolId) {
            // Pool yang sudah ada diubah rentangnya, bukan dibuat ulang — supaya
            // sesi yang sedang berjalan tidak kehilangan acuan pool.
            await client.execute([[
              '/ip/pool/set',
              `=.id=${poolId}`,
              `=ranges=${ranges}`,
              `=comment=${OWNER_COMMENT}`,
            ]]);
            poolNote = ` Pool "${poolName}" (${ranges}) diperbarui.`;
          } else {
            await client.execute([[
              '/ip/pool/add',
              `=name=${poolName}`,
              `=ranges=${ranges}`,
              `=comment=${OWNER_COMMENT}`,
            ]]);
            poolNote = ` Pool "${poolName}" (${ranges}) dibuat.`;
          }
        }
        this.logger.log(`MikroTik ${row.name}: ${poolNote.trim()}`);
      }

      const renameFrom = input.oldName && input.oldName !== input.name ? input.oldName : null;
      let id: string | undefined;

      if (renameFrom) {
        const old = (await client.execute([[`${path}/print`, `?name=${renameFrom}`]])).records ?? [];
        id = old[0]?.['.id'];
        if (id) {
          // Rename di tempat: objek yang sama ganti nama, referensi yang menunjuk
          // profil lama tetap utuh dan tidak meninggalkan profil duplikat.
          const words = [`${path}/set`, `=.id=${id}`, `=name=${input.name}`];
          for (const [key, value] of Object.entries(attributes)) words.push(`=${key}=${value}`);
          await client.execute([words]);
          this.logger.log(`MikroTik ${row.name}: profil ${input.type} "${renameFrom}" diubah nama menjadi "${input.name}"`);
          return { ok: true, action: 'renamed', device: row.name, message: `Profil "${renameFrom}" diubah nama menjadi "${input.name}" di ${row.name}.${poolNote}`, command };
        }
      }

      const existing = (await client.execute([[`${path}/print`, `?name=${input.name}`]])).records ?? [];
      id = existing[0]?.['.id'];

      if (id) {
        const words = [`${path}/set`, `=.id=${id}`];
        for (const [key, value] of Object.entries(attributes)) words.push(`=${key}=${value}`);
        await client.execute([words]);
        this.logger.log(`MikroTik ${row.name}: profil ${input.type} "${input.name}" diperbarui`);
        return { ok: true, action: 'updated', device: row.name, message: `Profil "${input.name}" diperbarui di ${row.name}.${poolNote}`, command };
      }

      const words = [`${path}/add`, `=name=${input.name}`];
      for (const [key, value] of Object.entries(attributes)) words.push(`=${key}=${value}`);
      await client.execute([words]);
      this.logger.log(`MikroTik ${row.name}: profil ${input.type} "${input.name}" dibuat`);
      return { ok: true, action: 'created', device: row.name, message: `Profil "${input.name}" dibuat di ${row.name}.${poolNote}`, command };
    } catch (error) {
      return {
        ok: false,
        action: 'failed',
        device: row.name,
        message: error instanceof Error ? error.message : String(error),
        command,
      };
    }
  }

  /** Atribut profil lokal dari sebuah Group Profile (tanpa rate-limit). */
  private groupProfileAttributes(input: {
    type: 'hotspot' | 'ppp';
    parentQueue?: string | null;
    poolName?: string | null;
    localAddress?: string | null;
    dnsPrimary?: string | null;
    dnsSecondary?: string | null;
    sharedUsers?: number | null;
  }): Record<string, string> {
    const attributes: Record<string, string> = {};
    const parentQueue = (input.parentQueue ?? '').trim();
    // Sentinel DEFAULT berarti tanpa parent queue. Nilainya harus DITULIS
    // sebagai `none`, bukan dilewati: kalau dilewati, `set` tidak menyentuh
    // parent-queue lama sehingga queue sebelumnya tetap menempel.
    attributes['parent-queue'] =
      !parentQueue || parentQueue.toUpperCase() === 'DEFAULT' ? 'none' : parentQueue;
    const pool = (input.poolName ?? '').trim();
    if (pool) {
      if (input.type === 'hotspot') attributes['address-pool'] = pool;
      else attributes['remote-address'] = pool;
    }
    // `dns-server` HANYA ada di /ppp/profile. Profil user hotspot tidak punya
    // properti itu — mengirimnya membuat RouterOS menolak seluruh perintah.
    // Untuk hotspot, DNS dikirim lewat atribut RADIUS (MS-Primary/Secondary-DNS).
    if (input.type === 'ppp') {
      const dns = [input.dnsPrimary, input.dnsSecondary]
        .map((value) => (value ?? '').trim())
        .filter(Boolean)
        .join(',');
      if (dns) attributes['dns-server'] = dns;
    }
    if (input.type === 'hotspot' && input.sharedUsers) {
      attributes['shared-users'] = String(input.sharedUsers);
    }
    if (input.type === 'ppp') {
      const local = (input.localAddress ?? '').trim();
      if (local) attributes['local-address'] = local;
      // RouterOS 6.49 MENOLAK `comment` pada /ip/hotspot/user/profile, jadi
      // penanda hanya dipasang di objek yang benar-benar mendukungnya.
      attributes['comment'] = OWNER_COMMENT;
    }
    return attributes;
  }

  // Menyiapkan perangkat sebagai NAS RADIUS lewat API: entri /radius (alamat
  // server + secret) dan listener CoA. Dipakai panel saat NAS disimpan dari GUI
  // supaya operator tidak perlu menyamakan dua sisi secara manual.
  async provisionRadiusNas(input: {
    address: string;
    secret: string;
    authPort: number;
    acctPort: number;
    coaPort: number;
    service?: string;
  }): Promise<{
    created: boolean;
    updated: boolean;
    address: string;
    service: string;
    incoming_accept: boolean;
    incoming_port: number;
    services: {
      ppp_aaa: { use_radius: boolean; changed: boolean };
      hotspot_profiles: Array<{ name: string; changed: boolean }>;
      hotspot_servers: number;
    };
  }> {
    const service = input.service ?? 'hotspot,ppp';
    const existingRows = await this.read('/radius/print');
    const existing = existingRows.find((row) => String(row.address ?? '') === input.address);
    const attributes: Record<string, string | undefined> = {
      secret: input.secret,
      service,
      'authentication-port': String(input.authPort),
      'accounting-port': String(input.acctPort),
      // Default RouterOS 300 ms terlalu pendek: balasan FreeRADIUS (SQL +
      // post-auth) bisa 0,4-1 detik, dan perangkat sudah menyerah lebih dulu
      // sehingga log-nya berbunyi "RADIUS server is not responding".
      timeout: '3s',
    };

    if (existing) {
      // RouterOS menolak `/radius/set` tanpa `=.id=`.
      await this.write(
        '/radius/set',
        { '.id': String(existing['.id'] ?? ''), ...attributes },
        'radius set',
      );
    } else {
      await this.write('/radius/add', { address: input.address, ...attributes }, 'radius add');
    }

    await this.write(
      '/radius/incoming/set',
      { accept: 'yes', port: String(input.coaPort) },
      'radius incoming set',
    );

    // Baca ulang: yang dilaporkan ke operator harus keadaan perangkat, bukan
    // asumsi bahwa perintah tadi berhasil.
    const [radiusRows, incomingRows] = await Promise.all([
      this.read('/radius/print'),
      this.read('/radius/incoming/print'),
    ]);
    const entry = radiusRows.find((row) => String(row.address ?? '') === input.address);
    if (!entry) {
      throw new BadGatewayException(
        `Perangkat tidak menampilkan entri /radius untuk ${input.address} setelah ditulis.`,
      );
    }
    const incoming = incomingRows[0] ?? {};
    const services = await this.enableRadiusServices();
    return {
      created: !existing,
      updated: Boolean(existing),
      address: input.address,
      service: String(entry.service ?? service),
      incoming_accept: String(incoming.accept ?? 'false') === 'true',
      incoming_port: Number(incoming.port ?? input.coaPort) || input.coaPort,
      services,
    };
  }

  // Autentikasi baru benar-benar lewat RADIUS bila layanannya memakai radius.
  // PPP memakai satu setelan global; hotspot per profil, dan hanya profil yang
  // benar-benar dipakai server hotspot — profil lain tidak disentuh.
  private async enableRadiusServices(): Promise<{
    ppp_aaa: { use_radius: boolean; changed: boolean };
    hotspot_profiles: Array<{ name: string; changed: boolean }>;
    hotspot_servers: number;
  }> {
    const aaaRows = await this.read('/ppp/aaa/print');
    const aaa = aaaRows[0] ?? {};
    const pppUseRadius = String(aaa['use-radius'] ?? 'false') === 'true';
    if (!pppUseRadius) {
      await this.write('/ppp/aaa/set', { 'use-radius': 'yes' }, 'ppp aaa set');
    }

    const servers = await this.read('/ip/hotspot/print').catch(() => []);
    const usedProfiles = new Set(
      servers.map((row) => String(row.profile ?? '')).filter((name) => name !== ''),
    );
    const profiles = await this.read('/ip/hotspot/profile/print').catch(() => []);
    const hotspotProfiles: Array<{ name: string; changed: boolean }> = [];
    for (const profile of profiles) {
      const name = String(profile.name ?? '');
      if (!usedProfiles.has(name)) continue;
      const enabled = String(profile['use-radius'] ?? 'false') === 'true';
      if (!enabled) {
        await this.write(
          '/ip/hotspot/profile/set',
          { '.id': String(profile['.id'] ?? ''), 'use-radius': 'yes' },
          'hotspot profile set',
        );
      }
      hotspotProfiles.push({ name, changed: !enabled });
    }

    return {
      ppp_aaa: { use_radius: true, changed: !pppUseRadius },
      hotspot_profiles: hotspotProfiles,
      hotspot_servers: servers.length,
    };
  }

  // Menghapus entri /radius yang menunjuk server kita — dipakai saat NAS
  // dihapus dari panel supaya perangkat tidak tertinggal menunjuk server mati.
  async removeRadiusNas(address: string): Promise<boolean> {
    const before = await this.read('/radius/print');
    const existing = before.find((row) => String(row.address ?? '') === address);
    if (!existing) return false;
    await this.write('/radius/remove', { '.id': String(existing['.id'] ?? '') }, 'radius remove');
    const after = await this.read('/radius/print');
    return !after.some((row) => String(row.address ?? '') === address);
  }

  /**
   * Pemeriksaan baca-saja sebelum sebuah perangkat didaftarkan sebagai NAS:
   * versi RouterOS, jam perangkat, rute ke server RADIUS, dan apakah perangkat
   * bisa menjangkau server. Tidak menulis apa pun ke perangkat.
   */
  async radiusPreflight(deviceId: number, serverAddress: string): Promise<RadiusPreflight> {
    const row = await this.devices.find(deviceId);
    if (!row) throw new NotFoundException(`Perangkat MikroTik id ${deviceId} tidak ditemukan.`);
    if (Number(row.is_active) !== 1) {
      throw new ServiceUnavailableException(`Perangkat "${row.name}" sedang dinonaktifkan.`);
    }
    const target = this.fromRow(row);
    if (!target.configured) {
      throw new ServiceUnavailableException(`Host/user API perangkat "${row.name}" belum lengkap.`);
    }
    const client = new RouterOsClient({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      timeoutMs: 8000,
    });

    const records = async (path: string): Promise<RouterOsRecord[]> => {
      const result = await client.execute([[path]]);
      return result.records ?? [];
    };

    let version = '';
    let identity = '';
    let clockDate = '';
    let clockTime = '';
    let timezone = '';
    let clockOffset = '';
    let existingRadius: RadiusPreflight['existing_radius'] = [];
    let nasAddress = target.host;
    let nasAddressSource: 'pref-src' | 'management-host' = 'management-host';
    let reachable = false;
    let pingDetail = 'belum diuji';
    let pingTested = false;
    // Listener CoA/Disconnect: bila accept=no, perangkat membuang paket tanpa
    // balasan, sehingga probe hanya terlihat sebagai timeout.
    let incoming: RadiusPreflight['incoming'] = { accept: false, port: 3799, read: false };

    try {
      const resource = (await records('/system/resource/print'))[0] ?? {};
      version = String(resource.version ?? '');
      const ident = (await records('/system/identity/print'))[0] ?? {};
      identity = String(ident.name ?? '');
      const clock = (await records('/system/clock/print'))[0] ?? {};
      clockDate = String(clock.date ?? '');
      clockTime = String(clock.time ?? '');
      timezone = String(clock['time-zone-name'] ?? '');
      // ROS 6 melaporkan offset ini (+07:00); dipakai untuk menghitung selisih
      // jam, bukan nama zona — nama zona tidak selalu cocok dengan offset aktif.
      clockOffset = String(clock['gmt-offset'] ?? '');

      const radius = await records('/radius/print');
      existingRadius = radius.map((entry) => ({
        address: String(entry.address ?? ''),
        auth_port: Number(entry['authentication-port'] ?? 0),
        acct_port: Number(entry['accounting-port'] ?? 0),
        service: String(entry.service ?? ''),
      }));

      // Alamat NAS = IP sumber paket RADIUS. Ambil dari rute connected yang
      // mencakup alamat server: pref-src (atau local-address) itulah sumber paket.
      try {
        const routes = await records('/ip/route/print');
        const covering = routes.find((route) => {
          const dst = String(route['dst-address'] ?? '');
          if (!dst || route.connect !== 'true') return false;
          return subnetContains(dst, serverAddress);
        });
        const candidate =
          covering?.['pref-src'] ?? String(covering?.['local-address'] ?? '').split('%')[0];
        if (typeof candidate === 'string' && candidate && candidate !== '') {
          nasAddress = candidate;
          nasAddressSource = 'pref-src';
        }
      } catch {
        /* rute tidak terbaca: pakai host manajemen */
      }

      try {
        const incomingRows = await records('/radius/incoming/print');
        const row = incomingRows[0] ?? {};
        incoming = {
          accept: String(row.accept ?? 'false') === 'true',
          port: Number(row.port ?? 3799) || 3799,
          read: true,
        };
      } catch {
        /* tidak terbaca: pesan galat menyebutkan pemeriksaan manual */
      }

      try {
        // ROS 7 menerima `/tool/ping`; ROS 6 menolaknya dan hanya menerima `/ping`.
        const pingWords = [`=address=${serverAddress}`, '=count=3', '=interval=200ms'];
        let replies: RouterOsRecord[] = [];
        try {
          const viaTool = await client.execute([['/tool/ping', ...pingWords]]);
          replies = (viaTool.records ?? []).filter((r) => String(r.status ?? '') !== 'failed');
        } catch {
          const viaPing = await client.execute([['/ping', ...pingWords]]);
          replies = (viaPing.records ?? []).filter((r) => String(r.status ?? '') !== 'failed');
        }
        reachable = replies.length > 0;
        pingTested = true;
        pingDetail = reachable
          ? `${replies.length} balasan dari ${serverAddress}`
          : `tidak ada balasan dari ${serverAddress}`;
      } catch (error) {
        // Perintah uji tidak diizinkan: jangan klaim "tidak terjangkau".
        pingTested = false;
        pingDetail =
          `pemeriksaan tidak bisa dijalankan: ${error instanceof Error ? error.message : String(error)}`;
      }
    } catch (error) {
      // Perangkat tidak bisa dibaca sama sekali: laporkan, jangan simpan NAS.
      throw new BadGatewayException(
        `Perangkat "${row.name}" tidak bisa dibaca: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const deviceMs = parseClock(clockDate, clockTime, clockOffset, timezone);
    const driftSeconds = deviceMs === null ? null : Math.round((deviceMs - Date.now()) / 1000);

    return {
      device_id: deviceId,
      device_name: row.name,
      host: target.host,
      identity,
      version,
      ros_version: version.startsWith('7') ? '7' : '6',
      clock: {
        date: clockDate,
        time: clockTime,
        timezone,
        gmt_offset: clockOffset,
        drift_seconds: driftSeconds,
      },
      nas_address: nasAddress,
      nas_address_source: nasAddressSource,
      incoming,
      existing_radius: existingRadius,
      reachability: { ok: reachable, tested: pingTested, detail: pingDetail },
      server_address: serverAddress,
    };
  }
}

export interface RadiusPreflight {
  device_id: number;
  device_name: string;
  host: string;
  identity: string;
  version: string;
  ros_version: RosVersionString;
  clock: {
    date: string;
    time: string;
    timezone: string;
    gmt_offset: string;
    drift_seconds: number | null;
  };
  nas_address: string;
  nas_address_source: 'pref-src' | 'management-host';
  incoming: { accept: boolean; port: number; read: boolean };
  existing_radius: { address: string; auth_port: number; acct_port: number; service: string }[];
  reachability: { ok: boolean; tested: boolean; detail: string };
  server_address: string;
}

type RosVersionString = '6' | '7';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Jam perangkat → epoch ms; null bila tidak terbaca.
 *
 * ROS 7 menulis tanggal `2026-10-25`; ROS 6 menulis `oct/26/2026`. Offset diambil
 * dari `gmt-offset` (+07:00), bukan dari nama zona: nama zona bisa berbeda dengan
 * offset yang benar-benar aktif (mis. Australia/Sydney +11:00 di perangkat ROS 6).
 */
export function parseClock(
  date: string,
  time: string,
  gmtOffset: string,
  timezone = '',
): number | null {
  if (!date || !time) return null;

  let iso = date;
  const ros6 = /^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i.exec(date.trim());
  if (ros6) {
    const month = MONTHS.indexOf(ros6[1].toLowerCase()) + 1;
    if (month === 0) return null;
    iso = `${ros6[3]}-${String(month).padStart(2, '0')}-${ros6[2].padStart(2, '0')}`;
  }

  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(gmtOffset.trim());
  let suffix = '';
  if (offsetMatch) {
    suffix = `${offsetMatch[1]}${offsetMatch[2]}:${offsetMatch[3]}`;
  } else if (timezone === 'Asia/Jakarta' || timezone === 'WIB') {
    suffix = '+07:00';
  }

  const parsed = Date.parse(`${iso}T${time}${suffix}`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Apakah `ip` berada di dalam subnet CIDR `dst` (IPv4). */
export function subnetContains(dst: string, ip: string): boolean {
  const [network, bitsRaw] = dst.split('/');
  const bits = Number(bitsRaw);
  const toInt = (value: string): number | null => {
    const parts = value.split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map((part) => Number(part));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  };
  const net = toInt(network);
  const target = toInt(ip);
  if (net === null || target === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (net & mask) === (target & mask);
}
/** Hasil penyiapan profil lokal di perangkat untuk sebuah Group Profile. */
export interface GroupProvisionResult {
  ok: boolean;
  /** created = dibuat, updated = disetel ulang, skipped = tidak bisa ditulis, failed = perangkat menolak. */
  action: 'created' | 'updated' | 'renamed' | 'skipped' | 'failed';
  device: string;
  message: string;
  /** Perintah setara untuk dijalankan manual bila API tidak bisa menulis. */
  command: string;
}

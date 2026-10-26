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
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { probeCoa } from './coa-probe';
import { RadiusConfigService } from './radius-config.service';
import {
  CreateNasDto,
  CreateRadiusUserDto,
  ListNasQueryDto,
  ListAuthLogQueryDto,
  ListRadiusUsersQueryDto,
  UpdateNasDto,
  UpdateRadiusUserDto,
} from './dto/radius.dto';
import { AssignGroupDto, SaveGroupDto } from './dto/radius-group.dto';
import { RADIUS_TABLES, RadiusRepository } from './radius.repository';

/** Toleransi selisih jam perangkat vs server sebelum NAS boleh disimpan. */
const NAS_CLOCK_TOLERANCE_SECONDS = 120;

export interface RadiusStatusView {
  database: string;
  host: string;
  auth_port: number;
  secret_configured: boolean;
  tables_present: string[];
  tables_missing: string[];
  ready: boolean;
  installed: boolean;
  message?: string;
  nas?: number;
  users?: number;
  active_sessions?: number;
  groups?: number;
  last_accounting_at?: string | null;
}

@Injectable()
export class RadiusService {
  private readonly logger = new Logger(RadiusService.name);

  constructor(
    private readonly radius: RadiusRepository,
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly mikrotik: MikrotikService,
    private readonly configService: RadiusConfigService,
  ) {}

  private async schemaState() {
    const existing = await this.radius.existingTables();
    const present = new Set(existing);
    const missing = RADIUS_TABLES.filter((table) => !present.has(table));
    return { existing, missing, ready: missing.length === 0 };
  }

  private async ensureReady(): Promise<void> {
    const state = await this.schemaState();
    if (!state.ready) {
      throw new ServiceUnavailableException(
        `Skema FreeRADIUS belum lengkap. Tabel yang belum ada: ${state.missing.join(', ')}. ` +
          'Jalankan migrasi backend/migrations/004_freeradius_schema.sql (lihat docs/freeradius-setup.md) setelah disetujui.',
      );
    }
  }

  // Status jujur: tabel ada/tidak, jumlah data, dan alamat RADIUS yang dipakai.
  async status(): Promise<RadiusStatusView> {
    const state = await this.schemaState();
    const base = {
      database: this.config.database.name,
      host: this.config.freeradius.host,
      auth_port: this.config.freeradius.port,
      secret_configured: Boolean(this.config.freeradius.secret),
      tables_present: state.existing,
      tables_missing: state.missing,
      ready: state.ready,
    };

    if (!state.ready) {
      return {
        ...base,
        installed: false,
        message:
          'Skema FreeRADIUS belum dibuat di database ini. Panel tidak menampilkan angka palsu: ' +
          'jalankan migrasi 004_freeradius_schema.sql lebih dulu.',
      };
    }

    const counts = await this.radius.counts();
    return {
      ...base,
      installed: true,
      nas: Number(counts.nas),
      users: Number(counts.users),
      active_sessions: Number(counts.sessions),
      groups: Number(counts.groups),
      last_accounting_at: await this.radius.lastAccountingAt(),
    };
  }

  async listNas(query: ListNasQueryDto) {
    await this.ensureReady();
    const result = await this.radius.listNas(query);
    return {
      rows: result.rows,
      total: result.total,
      page: query.page ?? null,
      limit: query.limit ?? null,
    };
  }

  async createNas(dto: CreateNasDto) {
    await this.ensureReady();

    const preflight = dto.device_id
      ? await this.mikrotik.radiusPreflight(dto.device_id, this.config.freeradius.nas_address)
      : null;

    // Alamat NAS = IP sumber paket RADIUS. Untuk perangkat yang diperiksa,
    // itu hasil pref-src; kalau tidak ada perangkat, pakai isian manual.
    const nasname = preflight?.nas_address ?? dto.nasname;
    if (!nasname) {
      throw new BadRequestException(
        'Isi "device_id" (pilih perangkat) atau "nasname" (alamat NAS) — salah satu wajib.',
      );
    }

    if (preflight) {
      // Jam perangkat menentukan acctstarttime dan masa aktif voucher.
      const drift = preflight.clock.drift_seconds;
      if (drift !== null && Math.abs(drift) > NAS_CLOCK_TOLERANCE_SECONDS) {
        throw new ConflictException(
          `Jam ${preflight.device_name} melenceng ${Math.abs(drift)} detik dari server ` +
            `(${preflight.clock.date} ${preflight.clock.time}). Perbaiki jam perangkat dulu — ` +
            'tanpa itu acctstarttime dan masa aktif voucher tidak bisa dipercaya.',
        );
      }
      if (!preflight.reachability.ok) {
        const detail = preflight.reachability.detail;
        throw new ConflictException(
          preflight.reachability.tested
            ? `${preflight.device_name} tidak bisa menjangkau server RADIUS ` +
              `${this.config.freeradius.nas_address} (${detail}). ` +
              'Periksa rute/firewall perangkat sebelum menyimpan NAS.'
            : `Jangkauan ${preflight.device_name} ke ${this.config.freeradius.nas_address} ` +
              `belum bisa diverifikasi (${detail}). NAS tidak disimpan karena ` +
              'konektivitas belum terbukti; perbaiki izin API perangkat atau periksa manual.',
        );
      }
      // Hanya satu entri /radius: kalau perangkat sudah menunjuk server lain,
      // jangan timpa diam-diam.
      const other = preflight.existing_radius.filter(
        (entry) => entry.address !== this.config.freeradius.nas_address,
      );
      if (other.length > 0) {
        throw new ConflictException(
          `${preflight.device_name} sudah memakai RADIUS lain (${other
            .map((entry) => `${entry.address}:${entry.auth_port}`)
            .join(', ')}). Hapus/ubah dulu di perangkat agar tidak ada dua server.`,
        );
      }
      if (preflight.existing_radius.length > 1) {
        throw new ConflictException(
          `${preflight.device_name} punya ${preflight.existing_radius.length} entri /radius. ` +
            'Sisakan satu server sebelum menyimpan NAS.',
        );
      }
    }

    if ((await this.radius.countNasUsingAddress(nasname)) > 0) {
      throw new ConflictException(`NAS dengan alamat ${nasname} sudah terdaftar`);
    }

    const rosVersion = dto.ros_version ?? preflight?.ros_version ?? '6';
    const secret = dto.secret;

    // Perangkat disiapkan lewat API sebelum diuji: entri /radius (alamat server
    // + secret yang diisi di panel) dan /radius incoming accept=yes. Tanpa ini
    // operator harus menyalin nilai yang sama di dua sisi, dan CoA selalu
    // timeout karena listener-nya masih mati.
    const provision = preflight
      ? await this.mikrotik.runWithDevice(preflight.device_id, () =>
          this.mikrotik.provisionRadiusNas({
            address: this.config.freeradius.nas_address,
            secret,
            authPort: 1812,
            acctPort: 1813,
            coaPort: preflight.incoming.read ? preflight.incoming.port : 3799,
          }),
        )
      : null;

    // Uji server → NAS sebelum menyimpan: Disconnect-Request ke port listener
    // perangkat. NAK tetap dianggap berhasil (paket sampai, secret cocok,
    // tidak ada sesi).
    const incoming = preflight?.incoming;
    const coaPort = provision?.incoming_port ?? (incoming?.read ? incoming.port : 3799);
    const coa = await probeCoa({
      host: nasname,
      port: coaPort,
      secret,
      timeoutMs: 3000,
      sourceAddress: this.config.freeradius.nas_address,
    });
    if (!coa.reachable) {
      const accepts = provision?.incoming_accept ?? incoming?.accept ?? false;
      const hint = provision || incoming?.read
        ? accepts
          ? `Perangkat menerima CoA di port ${coaPort}; periksa firewall input dan secret di perangkat.`
          : `Perangkat ${preflight?.device_name ?? ''} belum menerima CoA di port ${coaPort}. ` +
            `Aktifkan: /radius incoming set accept=yes port=${coaPort}`
        : 'Pastikan /radius incoming accept=yes dan secret sama di kedua sisi.';
      throw new ConflictException(`CoA ke ${nasname}:${coaPort} gagal — ${coa.detail} ${hint}`);
    }

    const id = await this.radius.createNas({ ...dto, nasname, ros_version: rosVersion });
    this.logger.log(
      `NAS RADIUS ditambahkan: ${nasname} (RouterOS ${rosVersion}, CoA ${coa.status})`,
    );

    // FreeRADIUS membaca daftar client hanya saat start: tanpa restart, NAS baru
    // tidak dikenali dan setiap paketnya dibuang sebagai unknown client.
    let radius_restarted = false;
    let restart_message = '';
    try {
      await this.configService.control('restart');
      radius_restarted = true;
    } catch (error) {
      restart_message =
        error instanceof Error ? error.message : 'Restart FreeRADIUS gagal — jalankan manual.';
      this.logger.warn(`Restart FreeRADIUS setelah menambah NAS gagal: ${restart_message}`);
    }

    return {
      id,
      nasname,
      ros_version: rosVersion,
      preflight,
      provision,
      services: provision?.services ?? null,
      coa: { status: coa.status, detail: coa.detail, elapsed_ms: coa.elapsed_ms },
      radius_restarted,
      restart_message: restart_message || undefined,
    };
  }

  /** Perangkat MikroTik yang belum terdaftar sebagai NAS. */
  async nasCandidates() {
    await this.ensureReady();
    const devices = await this.mikrotik.listDevices();
    const registered = await this.radius.listNasAddresses();
    const taken = new Set(registered);
    return {
      server_address: this.config.freeradius.nas_address,
      rows: devices.rows
        .filter((device) => Number(device.is_active) === 1)
        .map((device) => ({
          device_id: device.id,
          name: device.name,
          host: device.host,
          identity: device.last_identity,
          registered: taken.has(device.host),
        })),
    };
  }

  /**
   * Pemeriksaan baca-saja sebelum menyimpan: jam, jangkauan, /radius yang sudah
   * ada, dan alamat NAS. CoA belum diuji di sini karena butuh secret yang akan
   * dipakai — itu dijalankan saat menyimpan.
   */
  async nasPreflight(deviceId: number) {
    await this.ensureReady();
    const preflight = await this.mikrotik.radiusPreflight(
      deviceId,
      this.config.freeradius.nas_address,
    );
    const checks = [
      {
        name: 'jam',
        ok: preflight.clock.drift_seconds !== null && Math.abs(preflight.clock.drift_seconds) <= NAS_CLOCK_TOLERANCE_SECONDS,
        detail:
          preflight.clock.drift_seconds === null
            ? `jam tidak terbaca (${preflight.clock.date} ${preflight.clock.time})`
            : `selisih ${preflight.clock.drift_seconds} detik dari server`,
      },
      {
        name: 'jangkauan',
        ok: preflight.reachability.ok,
        detail: preflight.reachability.detail,
      },
      {
        name: 'coa',
        ok: preflight.incoming.read && preflight.incoming.accept,
        detail: preflight.incoming.read
          ? preflight.incoming.accept
            ? `CoA diterima di port ${preflight.incoming.port}`
            : `/radius incoming accept=no — Disconnect/CoA tidak akan dijawab perangkat`
          : '/radius incoming tidak terbaca (izin API perangkat)',
      },
      {
        name: 'radius',
        ok: preflight.existing_radius.every(
          (entry) => entry.address === this.config.freeradius.nas_address,
        ),
        detail:
          preflight.existing_radius.length === 0
            ? 'belum ada entri /radius di perangkat'
            : preflight.existing_radius
                .map((entry) => `${entry.address}:${entry.auth_port} (${entry.service})`)
                .join(', '),
      },
    ];
    return {
      server_address: this.config.freeradius.nas_address,
      registered: (await this.radius.listNasAddresses()).includes(preflight.nas_address),
      preflight,
      checks,
      ready_to_save: checks.every((check) => check.ok),
    };
  }

  async updateNas(id: number, dto: UpdateNasDto) {
    await this.ensureReady();
    const existing = await this.radius.findNas(id);
    if (!existing) throw new NotFoundException('NAS tidak ditemukan');
    await this.radius.updateNas(id, dto);
    return { id, updated: true };
  }

  async deleteNas(id: number) {
    await this.ensureReady();
    const existing = await this.radius.findNas(id);
    if (!existing) throw new NotFoundException('NAS tidak ditemukan');

    // Riwayat akuntansi menyebut NAS lewat kolom nasipaddress (tidak ada FK ke
    // `nas`), jadi keterkaitannya diperiksa eksplisit sebelum menghapus.
    const refs = await this.radius.nasReferences(existing.nasname);
    if (refs.accounting > 0) {
      throw new ConflictException(
        `NAS ${existing.nasname} tidak bisa dihapus: masih terkait ${refs.accounting} baris ` +
          'akuntansi di tabel radacct. Menghapusnya membuat riwayat sesi kehilangan identitas ' +
          'perangkat. Arsipkan atau hapus data akuntansi itu lebih dulu bila memang ingin ' +
          'menghapus NAS ini.',
      );
    }

    // Bersihkan perangkat: hapus entri /radius yang menunjuk server kita supaya
    // perangkat tidak tertinggal mengirim paket ke server yang tidak lagi
    // mengenalnya. Bila gagal, NAS tidak dihapus agar dua sisi tidak berbeda.
    const devices = await this.mikrotik.listDevices().catch(() => null);
    const device = devices?.rows.find((row) => row.host === existing.nasname) ?? null;
    let deviceResult: { device_id: number; name: string; removed: boolean } | null = null;
    if (device) {
      try {
        const removed = await this.mikrotik.runWithDevice(device.id, () =>
          this.mikrotik.removeRadiusNas(this.config.freeradius.nas_address),
        );
        deviceResult = { device_id: device.id, name: device.name, removed };
      } catch (error) {
        throw new ConflictException(
          `NAS ${existing.nasname} belum dihapus: entri /radius di perangkat ${device.name} ` +
            `gagal dibersihkan (${error instanceof Error ? error.message : String(error)}). ` +
            'Perbaiki akses/izin tulis perangkat lalu ulangi.',
        );
      }
    }

    await this.radius.deleteNas(id);
    this.logger.log(
      `NAS RADIUS dihapus: ${existing.nasname}` +
        (deviceResult ? ` (perangkat ${deviceResult.name})` : ' (tanpa perangkat terdaftar)'),
    );
    return { id, deleted: true, device: deviceResult };
  }

  // Log autentikasi dari radpostauth. Kolom identitas perangkat diisi query
  // post-auth FreeRADIUS (lihat jawara-radius-config), bukan oleh panel.
  async authLog(query: ListAuthLogQueryDto) {
    await this.ensureReady();
    if (!(await this.radius.authLogReady())) {
      throw new ServiceUnavailableException(
        'Kolom log autentikasi belum ada di tabel radpostauth. Jalankan migrasi ' +
          '011_radius_auth_log.sql lebih dulu (setelah backup database).',
      );
    }
    const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 500);
    const page = Math.max(Number(query.page ?? 1), 1);
    const result = await this.radius.authLog({
      search: query.search?.trim() || undefined,
      nas: query.nas?.trim() || undefined,
      mac: query.mac?.trim() || undefined,
      iface: query.iface?.trim() || undefined,
      station: query.station?.trim() || undefined,
      reply: query.reply?.trim() || undefined,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      rows: result.rows,
      total: result.total,
      page,
      limit,
      facets: await this.radius.authLogFacets(),
    };
  }

  async listUsers(query: ListRadiusUsersQueryDto) {
    await this.ensureReady();
    const result = await this.radius.listUsers(query);
    return {
      rows: result.rows,
      total: result.total,
      page: query.page ?? null,
      limit: query.limit ?? null,
    };
  }

  async createUser(dto: CreateRadiusUserDto, actor: { userId: number; ip: string }) {
    await this.ensureReady();
    if (await this.radius.findUser(dto.username)) {
      throw new ConflictException(`User RADIUS "${dto.username}" sudah ada`);
    }
    await this.radius.createUser(dto);
    await this.audit(actor, 'RADIUS_USER_CREATED', { username: dto.username, group: dto.group ?? null });
    return { username: dto.username, created: true };
  }

  async updateUser(username: string, dto: UpdateRadiusUserDto, actor: { userId: number; ip: string }) {
    await this.ensureReady();
    if (!(await this.radius.findUser(username))) {
      throw new NotFoundException(`User RADIUS "${username}" tidak ditemukan`);
    }
    await this.radius.updateUser(username, dto);
    await this.audit(actor, 'RADIUS_USER_UPDATED', {
      username,
      password_changed: dto.password !== undefined,
      group: dto.group ?? null,
    });
    return { username, updated: true };
  }

  async deleteUser(username: string, actor: { userId: number; ip: string }) {
    await this.ensureReady();
    if (!(await this.radius.findUser(username))) {
      throw new NotFoundException(`User RADIUS "${username}" tidak ditemukan`);
    }
    await this.radius.deleteUser(username);
    await this.audit(actor, 'RADIUS_USER_DELETED', { username });
    return { username, deleted: true };
  }

  async sessions(limit?: string) {
    await this.ensureReady();
    return this.radius.sessions(limit ? Number(limit) : 200);
  }

  async accounting(limit?: string) {
    await this.ensureReady();
    return this.radius.accounting(limit ? Number(limit) : 100);
  }

  // ---- Grup RADIUS -------------------------------------------------------
  // Grup menyimpan atribut bersama (rate-limit, session-timeout) yang dipakai
  // bersama oleh FreeRADIUS dan MikroTik, sehingga profile di kedua sisi bisa
  // disamakan dari satu tempat.
  async listGroups(search?: string) {
    await this.ensureReady();
    const rows = await this.radius.listGroups();
    const needle = (search ?? '').trim().toLowerCase();
    return needle
      ? rows.filter((row) => row.groupname.toLowerCase().includes(needle))
      : rows;
  }

  async getGroup(groupname: string) {
    await this.ensureReady();
    const detail = await this.radius.findGroup(groupname);
    if (detail.reply.length === 0 && detail.check.length === 0 && detail.users.length === 0) {
      throw new NotFoundException(`Grup "${groupname}" tidak ditemukan.`);
    }
    return { groupname, ...detail };
  }

  async saveGroup(dto: SaveGroupDto, actor: { userId: number; ip: string }) {
    await this.ensureReady();
    const exists = await this.radius.findGroup(dto.groupname);
    const isNew = exists.reply.length === 0 && exists.check.length === 0;

    await this.radius.saveGroup(dto.groupname, {
      reply: (dto.reply ?? []).map((row) => ({
        attribute: row.attribute,
        op: row.op,
        value: row.value,
      })),
      check: (dto.check ?? []).map((row) => ({
        attribute: row.attribute,
        op: row.op,
        value: row.value,
      })),
    });

    await this.audit(actor, isNew ? 'radius.group.create' : 'radius.group.update', {
      groupname: dto.groupname,
      reply: dto.reply?.length ?? 0,
      check: dto.check?.length ?? 0,
    });

    return this.getGroup(dto.groupname);
  }

  async deleteGroup(groupname: string, actor: { userId: number; ip: string }) {
    await this.ensureReady();
    const removedUsers = await this.radius.deleteGroup(groupname);
    await this.audit(actor, 'radius.group.delete', { groupname, removed_users: removedUsers });
    return { groupname, removed_users: removedUsers };
  }

  // Memindahkan satu user ke grup lain (atau melepasnya bila groupname kosong).
  async assignUser(dto: AssignGroupDto, actor: { userId: number; ip: string }) {
    await this.ensureReady();
    await this.radius.updateUser(dto.username, { group: dto.groupname ?? '' });
    await this.audit(actor, 'radius.user.group', {
      username: dto.username,
      groupname: dto.groupname ?? '',
    });
    return { username: dto.username, groupname: dto.groupname ?? '' };
  }

  private async audit(
    actor: { userId: number; ip: string },
    action: string,
    details: Record<string, unknown>,
  ) {
    // audit_logs.user_id masih NOT NULL di produksi (migrasi 002 belum
    // dijalankan), jadi aktor asli selalu diisi.
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
}
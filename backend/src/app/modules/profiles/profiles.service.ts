import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { isResellerRole } from '../auth/request-scope';
import {
  BandwidthRepository,
  GroupProfileRepository,
  ServiceProfileRepository,
  VoucherRepository,
  type GroupProfileRow,
  type ServiceProfileRow,
} from './profiles.repository';
import {
  CreateBandwidthDto,
  CreateGroupProfileDto,
  CreateServiceProfileDto,
  GenerateVoucherDto,
  UpdateBandwidthDto,
  UpdateGroupProfileDto,
  UpdateServiceProfileDto,
} from './dto/profiles.dto';
import { finalPrice, toRadiusMapping } from './profile-mapping';
import { BURST_FACTOR } from './rate-limit';
import { buildVoucherPdf, VoucherCard } from './voucher-pdf';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { quotaToBytes, unitToSeconds } from './rate-limit';

// role ikut dibawa karena kepemilikan data berbeda per peran: reseller hanya
// melihat datanya sendiri, admin/operator melihat semua. Nilai role SELALU
// berasal dari akun terautentikasi di server, tidak pernah dari body/query.
type Actor = { userId: number; ip: string; role?: string };
type ProfileType = 'hotspot' | 'ppp';

// Karakter voucher: tanpa 0/O/1/I/L agar tidak salah baca saat dicetak.
const VOUCHER_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += VOUCHER_CHARS[randomInt(VOUCHER_CHARS.length)];
  return out;
}

/**
 * Validasi sumber IP untuk sebuah grup.
 *
 * Empat mode, dan dua di antaranya terikat tipe:
 *
 *   group-pool   GROUP ONLY (Hotspot Only). RADIUS memakai profil hotspot
 *                bawaan router, jadi tidak ada pool maupun profil yang
 *                dibuat — rentang TIDAK wajib. Hanya untuk hotspot.
 *   router-pool  Panel membuat /ip/pool per router + profil PPP. Wajib rentang
 *                dan IP local gateway di luar rentang. Hanya untuk PPP.
 *   mikrotik-pool  Menunjuk pool yang sudah ada di router.
 *   sql-ippool     Alamat dari RADIUS; tidak ada pool di router.
 */
export function assertPoolSource(input: {
  mode: string;
  type: ProfileType;
  poolName?: string | null;
  localAddress?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}) {
  if (input.mode === 'group-pool' && input.type !== 'hotspot') {
    throw new BadRequestException(
      'Mode GROUP ONLY (Hotspot Only) hanya untuk grup bertipe hotspot.',
    );
  }
  if (input.mode === 'router-pool' && input.type !== 'ppp') {
    throw new BadRequestException('Mode IP pool MikroTik (per router) hanya untuk grup bertipe PPP.');
  }

  // GROUP ONLY tidak membuat apa pun di router: tidak ada pool, tidak ada
  // profil hotspot. Rentang yang terlanjur diisi diabaikan, bukan ditolak.
  if (input.mode === 'group-pool') return;

  if (input.mode === 'mikrotik-pool' && !input.poolName) {
    throw new BadRequestException(
      'Mode pool mikrotik-pool wajib menyebutkan nama IP pool di router.',
    );
  }

  if (input.mode !== 'router-pool') return;

  const start = (input.rangeStart ?? '').trim();
  const end = (input.rangeEnd ?? '').trim();
  if (!start || !end) {
    throw new BadRequestException('Mode router-pool wajib mengisi IP awal dan IP akhir.');
  }

  const startInt = ipToInt(start);
  const endInt = ipToInt(end);
  if (startInt === null || endInt === null) {
    throw new BadRequestException('IP awal/akhir pool harus alamat IPv4 yang valid.');
  }
  if (startInt > endInt) {
    throw new BadRequestException('IP awal pool harus lebih kecil atau sama dengan IP akhir.');
  }
  if (endInt - startInt > 65_534) {
    throw new BadRequestException('Rentang pool terlalu besar (maksimum 65.535 alamat).');
  }

  const local = (input.localAddress ?? '').trim();
  if (!local) {
    throw new BadRequestException(
      'Grup PPP wajib mengisi IP local (gateway sesi), dan alamat itu tidak boleh masuk ke pool.',
    );
  }
  const localInt = ipToInt(local);
  if (localInt === null) {
    throw new BadRequestException('IP local harus alamat IPv4 yang valid.');
  }
  if (localInt >= startInt && localInt <= endInt) {
    throw new BadRequestException(
      `IP local ${local} berada di dalam rentang pool ${start}-${end}. ` +
        'Gateway sesi harus di luar rentang agar tidak dibagikan ke pelanggan.',
    );
  }
}

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly bandwidths: BandwidthRepository,
    private readonly groups: GroupProfileRepository,
    private readonly profiles: ServiceProfileRepository,
    private readonly vouchers: VoucherRepository,
    private readonly db: DatabaseService,
    private readonly mikrotik: MikrotikService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // -------------------------------------------------------------------------
  // Bandwidth
  // -------------------------------------------------------------------------
  // Reseller dibatasi ke datanya sendiri; admin/operator tanpa filter.
  private ownerScope(actor: Actor): number | undefined {
    return isResellerRole(actor.role) ? actor.userId : undefined;
  }

  /**
   * Pemilik yang akan disimpan untuk data baru.
   *
   *   admin    → boleh menunjuk akun lain (dropdown di form)
   *   lainnya  → selalu dirinya sendiri; nilai dari body diabaikan
   *
   * Dipakai juga untuk memeriksa keunikan nama: nama profil unik per pemilik,
   * bukan global, supaya reseller A dan B boleh sama-sama punya "RUMAHAN".
   */
  private async resolveOwner(actor: Actor, requested?: number | null): Promise<number> {
    if (actor.role !== 'admin') return actor.userId;
    if (requested === undefined || requested === null) return actor.userId;
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new BadRequestException('owner_id tidak valid.');
    }
    const rows = await this.db.query<{ id: number; is_active: number }>(
      'SELECT id, is_active FROM users WHERE id = ?',
      [requested],
    );
    if (rows.length === 0) {
      throw new BadRequestException(`Akun pemilik #${requested} tidak ditemukan.`);
    }
    if (Number(rows[0].is_active) !== 1) {
      throw new BadRequestException(`Akun pemilik #${requested} tidak aktif.`);
    }
    return requested;
  }

  // Pemilik NULL berarti data tanpa pemilik (mis. akun pembuatnya dihapus):
  // hanya admin/operator yang boleh mengaksesnya.
  private canAccess(ownerId: number | null, actor: Actor): boolean {
    if (!isResellerRole(actor.role)) return true;
    return ownerId !== null && Number(ownerId) === actor.userId;
  }

  listBandwidths(actor: Actor, search?: string) {
    return this.bandwidths.list(this.ownerScope(actor), search);
  }

  async getBandwidth(actor: Actor, id: number) {
    const row = await this.bandwidths.findById(id);
    if (!row || !this.canAccess(row.owner_id, actor)) {
      throw new NotFoundException(`Bandwidth #${id} tidak ditemukan.`);
    }
    return row;
  }

  async createBandwidth(actor: Actor, dto: CreateBandwidthDto) {
    const ownerId = await this.resolveOwner(actor, dto.owner_id);
    await this.assertBandwidthNameFree(ownerId, dto.name);
    this.assertBandwidthValues({
      min_upload_kbps: dto.min_upload_kbps ?? 0,
      min_download_kbps: dto.min_download_kbps ?? 0,
      max_upload_kbps: dto.max_upload_kbps,
      max_download_kbps: dto.max_download_kbps,
      burst_enabled: dto.burst_enabled === true,
      burst_upload_kbps: dto.burst_upload_kbps ?? null,
      burst_download_kbps: dto.burst_download_kbps ?? null,
      burst_threshold_upload_kbps: dto.burst_threshold_upload_kbps ?? null,
      burst_threshold_download_kbps: dto.burst_threshold_download_kbps ?? null,
    });

    const id = await this.bandwidths.create({
      owner_id: ownerId,
      created_by: actor.userId,
      name: dto.name.trim(),
      min_upload_kbps: dto.min_upload_kbps ?? 0,
      min_download_kbps: dto.min_download_kbps ?? 0,
      max_upload_kbps: dto.max_upload_kbps,
      max_download_kbps: dto.max_download_kbps,
      burst_enabled: dto.burst_enabled ? 1 : 0,
      burst_upload_kbps: dto.burst_enabled ? (dto.burst_upload_kbps ?? null) : null,
      burst_download_kbps: dto.burst_enabled ? (dto.burst_download_kbps ?? null) : null,
      burst_threshold_upload_kbps: dto.burst_enabled ? (dto.burst_threshold_upload_kbps ?? null) : null,
      burst_threshold_download_kbps: dto.burst_enabled ? (dto.burst_threshold_download_kbps ?? null) : null,
      burst_time_sec: dto.burst_enabled ? (dto.burst_time_sec ?? null) : null,
      // 8 = prioritas paling rendah (RouterOS: 1 tertinggi). Pelanggan biasa
      // tidak boleh otomatis mendapat prioritas tertinggi.
      priority: dto.priority ?? 8,
    });
    await this.audit(actor, 'bandwidth.create', { id, name: dto.name });
    return this.bandwidths.findById(id);
  }

  async updateBandwidth(actor: Actor, id: number, dto: UpdateBandwidthDto) {
    const current = await this.getBandwidth(actor, id);
    if (dto.name) {
      await this.assertBandwidthNameFree(actor.userId, dto.name, id);
    }
    const merged = {
      min_upload_kbps: dto.min_upload_kbps ?? Number(current.min_upload_kbps),
      min_download_kbps: dto.min_download_kbps ?? Number(current.min_download_kbps),
      max_upload_kbps: dto.max_upload_kbps ?? Number(current.max_upload_kbps),
      max_download_kbps: dto.max_download_kbps ?? Number(current.max_download_kbps),
    };
    // Burst ikut divalidasi memakai nilai gabungan: patch parsial (mis. hanya
    // max dinaikkan) tidak boleh diam-diam menyisakan burst yang jadi lebih kecil.
    const burstEnabled =
      dto.burst_enabled !== undefined ? dto.burst_enabled : Number(current.burst_enabled) === 1;
    this.assertBandwidthValues({
      ...merged,
      burst_enabled: burstEnabled,
      burst_upload_kbps:
        dto.burst_upload_kbps !== undefined
          ? dto.burst_upload_kbps
          : current.burst_upload_kbps === null
            ? null
            : Number(current.burst_upload_kbps),
      burst_download_kbps:
        dto.burst_download_kbps !== undefined
          ? dto.burst_download_kbps
          : current.burst_download_kbps === null
            ? null
            : Number(current.burst_download_kbps),
      burst_threshold_upload_kbps:
        dto.burst_threshold_upload_kbps !== undefined
          ? dto.burst_threshold_upload_kbps
          : current.burst_threshold_upload_kbps === null
            ? null
            : Number(current.burst_threshold_upload_kbps),
      burst_threshold_download_kbps:
        dto.burst_threshold_download_kbps !== undefined
          ? dto.burst_threshold_download_kbps
          : current.burst_threshold_download_kbps === null
            ? null
            : Number(current.burst_threshold_download_kbps),
    });

    const data: Record<string, unknown> = {
      name: dto.name?.trim() ?? current.name,
      ...merged,
    };
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.burst_enabled !== undefined) {
      data.burst_enabled = dto.burst_enabled ? 1 : 0;
      if (!dto.burst_enabled) {
        Object.assign(data, {
          burst_upload_kbps: null,
          burst_download_kbps: null,
          burst_threshold_upload_kbps: null,
          burst_threshold_download_kbps: null,
          burst_time_sec: null,
        });
      }
    }
    for (const field of [
      'burst_upload_kbps',
      'burst_download_kbps',
      'burst_threshold_upload_kbps',
      'burst_threshold_download_kbps',
      'burst_time_sec',
    ]) {
      const value = (dto as Record<string, unknown>)[field];
      if (value !== undefined) data[field] = value;
    }

    await this.bandwidths.update(id, data);
    await this.audit(actor, 'bandwidth.update', { id, ...data });
    return this.bandwidths.findById(id);
  }

  async removeBandwidth(actor: Actor, id: number) {
    await this.getBandwidth(actor, id);
    const used = await this.bandwidths.usageCount(id);
    if (used > 0) {
      throw new ConflictException(
        `Bandwidth masih dipakai ${used} profil. Ubah profil tersebut lebih dulu.`,
      );
    }
    await this.bandwidths.remove(id);
    await this.audit(actor, 'bandwidth.delete', { id });
    return { id, deleted: true };
  }

  private async assertBandwidthNameFree(ownerId: number, name: string, exceptId?: number) {
    const existing = await this.bandwidths.findByName(ownerId, name.trim(), exceptId);
    if (existing) {
      throw new ConflictException(`Nama bandwidth "${name.trim()}" sudah dipakai.`);
    }
  }

  private assertBandwidthValues(v: {
    min_upload_kbps: number;
    min_download_kbps: number;
    max_upload_kbps: number;
    max_download_kbps: number;
    burst_enabled?: boolean;
    burst_upload_kbps?: number | null;
    burst_download_kbps?: number | null;
    burst_threshold_upload_kbps?: number | null;
    burst_threshold_download_kbps?: number | null;
  }) {
    if (v.max_upload_kbps < 1 || v.max_download_kbps < 1) {
      throw new BadRequestException('Max upload dan max download wajib lebih dari 0.');
    }
    if (v.min_upload_kbps > v.max_upload_kbps) {
      throw new BadRequestException('Min upload tidak boleh melebihi max upload.');
    }
    if (v.min_download_kbps > v.max_download_kbps) {
      throw new BadRequestException('Min download tidak boleh melebihi max download.');
    }

    // RouterOS menolak burst yang lebih kecil dari max
    // ("download-burst-limit less than download-max-limit"), dan login pelanggan
    // ikut gagal. Tolak di sini supaya operator tahu sebelum tersimpan.
    if (!v.burst_enabled) return;

    const pairs: Array<[string, number | null | undefined, number, number | null | undefined]> = [
      ['Burst upload', v.burst_upload_kbps, v.max_upload_kbps, v.burst_threshold_upload_kbps],
      ['Burst download', v.burst_download_kbps, v.max_download_kbps, v.burst_threshold_download_kbps],
    ];
    for (const [label, burst, max, threshold] of pairs) {
      if (burst !== null && burst !== undefined && burst > 0 && burst < max) {
        throw new BadRequestException(
          `${label} (${burst} kbps) tidak boleh lebih kecil dari max (${max} kbps). ` +
            'RouterOS akan menolak queue dan pelanggan gagal login.',
        );
      }
      // Batas atas: burst hanya boleh naik sampai 2x max.
      if (burst !== null && burst !== undefined && burst > max * BURST_FACTOR) {
        throw new BadRequestException(
          `${label} (${burst} kbps) melebihi batas ${BURST_FACTOR}x max (${max * BURST_FACTOR} kbps). ` +
            'Burst maksimal 2x dari max-limit.',
        );
      }
      if (burst && threshold !== null && threshold !== undefined && threshold > burst) {
        throw new BadRequestException(
          `Threshold ${label.toLowerCase()} (${threshold} kbps) tidak boleh melebihi burst (${burst} kbps).`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Group Profile
  // -------------------------------------------------------------------------
  listGroups(actor: Actor, type?: string, search?: string) {
    return this.groups.list(this.ownerScope(actor), type, search);
  }

  async getGroup(actor: Actor, id: number) {
    const row = await this.groups.findById(id);
    if (!row || !this.canAccess(row.owner_id, actor)) {
      throw new NotFoundException(`Group Profile #${id} tidak ditemukan.`);
    }
    return row;
  }

  async createGroup(actor: Actor, dto: CreateGroupProfileDto) {
    const ownerId = await this.resolveOwner(actor, dto.owner_id);
    await this.assertGroupNameFree(ownerId, dto.type, dto.name);
    await this.assertRouterExists(dto.router_id);
    const poolMode = dto.pool_mode ?? 'mikrotik-pool';
    this.assertPool({
      mode: poolMode,
      type: dto.type,
      poolName: dto.mikrotik_pool_name,
      localAddress: dto.pool_local_address,
      rangeStart: dto.pool_range_start,
      rangeEnd: dto.pool_range_end,
    });

    // Nama pool yang dibuat panel: deterministik dari nama grup, sehingga
    // penghapusan tahu persis objek mana yang miliknya. GROUP ONLY tidak punya
    // pool sama sekali.
    const poolName =
      poolMode === 'router-pool'
        ? poolNameFor(dto.name.trim())
        : poolMode === 'group-pool'
          ? null
          : (dto.mikrotik_pool_name ?? null);

    const id = await this.groups.create({
      owner_id: ownerId,
      created_by: actor.userId,
      router_id: dto.router_id,
      name: dto.name.trim(),
      type: dto.type,
      pool_mode: poolMode,
      mikrotik_pool_name: poolName,
      pool_local_address: poolMode === 'router-pool' ? (dto.pool_local_address ?? null) : null,
      pool_range_start: poolMode === 'router-pool' ? (dto.pool_range_start ?? null) : null,
      pool_range_end: poolMode === 'router-pool' ? (dto.pool_range_end ?? null) : null,
      pool_created: 0,
      dns_primary: dto.dns_primary ?? null,
      dns_secondary: dto.dns_secondary ?? null,
      parent_queue: dto.parent_queue ?? null,
      use_router_default: dto.use_router_default ? 1 : 0,
    });
    await this.audit(actor, 'group_profile.create', { id, name: dto.name, type: dto.type });

    // Profil lokal di perangkat: parent queue hanya bisa menempel di sini,
    // tidak bisa dikirim lewat RADIUS. Rate-limit sengaja tidak ditulis.
    const provisioning = await this.provisionGroup({
      deviceId: dto.router_id,
      type: dto.type,
      name: dto.name.trim(),
      parentQueue: dto.parent_queue ?? null,
      poolName: poolName,
      poolMode: poolMode,
      poolLocalAddress: dto.pool_local_address ?? null,
      poolRangeStart: dto.pool_range_start ?? null,
      poolRangeEnd: dto.pool_range_end ?? null,
      dnsPrimary: dto.dns_primary ?? null,
      dnsSecondary: dto.dns_secondary ?? null,
      useRouterDefault: Boolean(dto.use_router_default),
    });
    await this.audit(actor, 'group_profile.provision', {
      id,
      name: dto.name,
      action: provisioning.action,
      device: provisioning.device,
    });

    const saved = await this.groups.findById(id);
    return { ...saved, provisioning };
  }

  /**
   * Menyiapkan profil lokal di router. `use_router_default` berarti grup
   * memakai profil bawaan perangkat, jadi tidak ada yang dibuat.
   */
  private async provisionGroup(input: {
    deviceId: number;
    type: ProfileType;
    name: string;
    parentQueue: string | null;
    poolName: string | null;
    poolMode: string;
    poolLocalAddress: string | null;
    poolRangeStart: string | null;
    poolRangeEnd: string | null;
    dnsPrimary: string | null;
    dnsSecondary: string | null;
    useRouterDefault: boolean;
  }) {
    if (input.useRouterDefault) {
      return {
        ok: true,
        action: 'skipped' as const,
        device: `#${input.deviceId}`,
        message: 'Grup memakai profil bawaan router — tidak ada profil dibuat.',
        command: '',
      };
    }
    // GROUP ONLY (Hotspot Only): RADIUS memakai profil hotspot bawaan router,
    // jadi tidak ada IP pool maupun profil user hotspot yang ditulis.
    if (input.poolMode === 'group-pool') {
      return {
        ok: true,
        action: 'skipped' as const,
        device: `#${input.deviceId}`,
        message:
          'Mode GROUP ONLY: tidak ada IP pool atau profil hotspot yang ditulis. ' +
          'RADIUS memakai profil hotspot bawaan router.',
        command: '',
      };
    }
    return this.mikrotik.provisionGroupProfile({
      deviceId: input.deviceId,
      type: input.type,
      name: input.name,
      parentQueue: input.parentQueue,
      poolName: input.poolName,
      // Pool hanya dibuat panel pada mode router-pool (PPP); mode lain memakai
      // pool yang sudah ada di router.
      createPool:
        input.poolMode === 'router-pool'
          ? {
              name: input.poolName as string,
              rangeStart: input.poolRangeStart as string,
              rangeEnd: input.poolRangeEnd as string,
            }
          : null,
      localAddress: input.type === 'ppp' ? input.poolLocalAddress : null,
      dnsPrimary: input.dnsPrimary,
      dnsSecondary: input.dnsSecondary,
      sharedUsers: null,
    });
  }

  async updateGroup(actor: Actor, id: number, dto: UpdateGroupProfileDto) {
    const current = await this.getGroup(actor, id);
    const type = (dto.type ?? current.type) as ProfileType;
    const name = dto.name?.trim() ?? current.name;
    if (dto.name || dto.type) {
      await this.assertGroupNameFree(actor.userId, type, name, id);
    }
    if (dto.router_id !== undefined) await this.assertRouterExists(dto.router_id);

    const poolMode = dto.pool_mode ?? current.pool_mode;
    // Pada mode router-pool nama pool mengikuti nama grup, bukan input bebas.
    const poolName =
      poolMode === 'router-pool'
        ? poolNameFor(name)
        : poolMode === 'group-pool'
          ? null
          : (dto.mikrotik_pool_name ?? current.mikrotik_pool_name);
    this.assertPool({
      mode: poolMode,
      type,
      poolName,
      localAddress: dto.pool_local_address ?? current.pool_local_address,
      rangeStart: dto.pool_range_start ?? current.pool_range_start,
      rangeEnd: dto.pool_range_end ?? current.pool_range_end,
    });

    // Tipe grup tidak boleh diubah bila sudah dipakai profil: profil hotspot
    // tidak bisa menempel ke grup PPP.
    if (dto.type && dto.type !== current.type) {
      const used = await this.groups.usageCount(id);
      if (used > 0) {
        throw new ConflictException(
          'Type grup tidak bisa diubah karena sudah dipakai profil/voucher.',
        );
      }
    }

    const data: Record<string, unknown> = {
      name,
      type,
      router_id: dto.router_id ?? current.router_id,
      pool_mode: poolMode,
      mikrotik_pool_name: poolMode === 'sql-ippool' ? null : poolName,
      pool_local_address:
        poolMode === 'router-pool'
          ? (dto.pool_local_address ?? current.pool_local_address)
          : null,
      pool_range_start:
        poolMode === 'router-pool' ? (dto.pool_range_start ?? current.pool_range_start) : null,
      pool_range_end:
        poolMode === 'router-pool' ? (dto.pool_range_end ?? current.pool_range_end) : null,
      dns_primary: dto.dns_primary ?? current.dns_primary,
      dns_secondary: dto.dns_secondary ?? current.dns_secondary,
      parent_queue: dto.parent_queue ?? current.parent_queue,
      use_router_default:
        dto.use_router_default === undefined
          ? Number(current.use_router_default)
          : dto.use_router_default
            ? 1
            : 0,
    };

    await this.groups.update(id, data);
    await this.audit(actor, 'group_profile.update', { id, ...data });

    // Setel ulang profil lokal agar perangkat mengikuti grup.
    // Catatan jujur: bila nama grup berubah, profil LAMA tetap ada di perangkat
    // (tidak dihapus otomatis) — penghapusan profil sengaja manual.
    const provisioning = await this.provisionGroup({
      deviceId: Number(data.router_id),
      type: type,
      name: name,
      parentQueue: (data.parent_queue as string | null) ?? null,
      poolName: (data.mikrotik_pool_name as string | null) ?? null,
      poolMode: String(data.pool_mode),
      poolLocalAddress: (data.pool_local_address as string | null) ?? null,
      poolRangeStart: (data.pool_range_start as string | null) ?? null,
      poolRangeEnd: (data.pool_range_end as string | null) ?? null,
      dnsPrimary: (data.dns_primary as string | null) ?? null,
      dnsSecondary: (data.dns_secondary as string | null) ?? null,
      useRouterDefault: Number(data.use_router_default) === 1,
    });
    await this.audit(actor, 'group_profile.provision', {
      id,
      name,
      action: provisioning.action,
      device: provisioning.device,
    });

    const saved = await this.groups.findById(id);
    return { ...saved, provisioning, renamed_from: name !== current.name ? current.name : undefined };
  }

  async removeGroup(actor: Actor, id: number) {
    await this.getGroup(actor, id);
    const used = await this.groups.usageCount(id);
    if (used > 0) {
      throw new ConflictException(
        `Group Profile masih dipakai ${used} profil/voucher. Pindahkan lebih dulu.`,
      );
    }
    await this.groups.remove(id);
    await this.audit(actor, 'group_profile.delete', { id });
    return { id, deleted: true };
  }

  private async assertGroupNameFree(
    ownerId: number,
    type: string,
    name: string,
    exceptId?: number,
  ) {
    const existing = await this.groups.findByName(ownerId, type, name.trim(), exceptId);
    if (existing) {
      throw new ConflictException(
        `Group Profile "${name.trim()}" untuk tipe ${type} sudah ada.`,
      );
    }
  }

  private async assertRouterExists(routerId: number) {
    const rows = await this.db.query<{ id: number }>(
      'SELECT id FROM mikrotik_devices WHERE id = ?',
      [routerId],
    );
    if (rows.length === 0) {
      throw new BadRequestException('Router tidak ditemukan pada daftar perangkat MikroTik.');
    }
  }

  private assertPool(input: Parameters<typeof assertPoolSource>[0]) {
    assertPoolSource(input);
  }

  // -------------------------------------------------------------------------
  // Profile Hotspot / PPP
  // -------------------------------------------------------------------------
  listProfiles(actor: Actor, type: ProfileType, search?: string) {
    return this.profiles.list(type, this.ownerScope(actor), search);
  }

  async getProfile(actor: Actor, type: ProfileType, id: number) {
    const row = await this.profiles.findById(type, id);
    if (!row || !this.canAccess(row.owner_id, actor)) {
      throw new NotFoundException(`Profil ${type} #${id} tidak ditemukan.`);
    }
    return row;
  }

  async createProfile(actor: Actor, type: ProfileType, dto: CreateServiceProfileDto) {
    const ownerId = await this.resolveOwner(actor, dto.owner_id);
    await this.assertProfileNameFree(ownerId, type, dto.name);
    const group = await this.resolveGroup(actor, type, dto.group_profile_id);
    await this.getBandwidth(actor, dto.bandwidth_id);
    const normalized = this.normalizeProfile(type, dto, group);

    const id = await this.profiles.create(type, {
      owner_id: ownerId,
      created_by: actor.userId,
      group_profile_id: dto.group_profile_id,
      bandwidth_id: dto.bandwidth_id,
      name: dto.name.trim(),
      ...normalized,
    });
    await this.syncRadius(type, id);
    await this.audit(actor, `${type}_profile.create`, { id, name: dto.name });
    return this.profiles.findById(type, id);
  }

  async updateProfile(
    actor: Actor,
    type: ProfileType,
    id: number,
    dto: UpdateServiceProfileDto,
  ) {
    const current = await this.getProfile(actor, type, id);
    if (dto.name) await this.assertProfileNameFree(actor.userId, type, dto.name, id);

    const group = await this.resolveGroup(
      actor,
      type,
      dto.group_profile_id ?? Number(current.group_profile_id),
    );
    if (dto.bandwidth_id !== undefined) await this.getBandwidth(actor, dto.bandwidth_id);

    // Gabungkan nilai lama dengan perubahan sebelum divalidasi, supaya aturan
    // (mis. limited wajib punya batas) tidak bisa dilewati dengan patch parsial.
    const merged: CreateServiceProfileDto = {
      name: dto.name?.trim() ?? current.name,
      group_profile_id: dto.group_profile_id ?? Number(current.group_profile_id),
      bandwidth_id: dto.bandwidth_id ?? Number(current.bandwidth_id),
      cost_price: dto.cost_price ?? Number(current.cost_price),
      sell_price: dto.sell_price ?? Number(current.sell_price),
      promo_price: dto.promo_price ?? Number(current.promo_price),
      tax_percent: dto.tax_percent ?? Number(current.tax_percent),
      quota_type: (dto.quota_type ?? current.quota_type ?? 'unlimited') as
        | 'unlimited'
        | 'limited',
      timebase_value: dto.timebase_value ?? current.timebase_value ?? null,
      timebase_unit: dto.timebase_unit ?? current.timebase_unit ?? null,
      quotabase_value: dto.quotabase_value ?? current.quotabase_value ?? null,
      quotabase_unit: dto.quotabase_unit ?? current.quotabase_unit ?? null,
      validity_value: dto.validity_value ?? Number(current.validity_value),
      validity_unit: dto.validity_unit ?? current.validity_unit,
      shared_users: dto.shared_users ?? Number(current.shared_users),
      priority: dto.priority ?? Number(current.priority),
      login_days: dto.login_days ?? (current.login_days ? current.login_days.split(',') : null),
      login_start: dto.login_start ?? current.login_start,
      login_end: dto.login_end ?? current.login_end,
      is_active: dto.is_active ?? Number(current.is_active) === 1,
      // Limitasi grup PPP: ikut digabung agar patch parsial tidak menghapusnya.
      time_limit_value:
        dto.time_limit_value ??
        (Number(current.time_limit_seconds ?? 0) > 0
          ? Math.round(Number(current.time_limit_seconds) / 3600)
          : null),
      time_limit_unit: dto.time_limit_unit ?? 'hour',
      quota_limit_value:
        dto.quota_limit_value ??
        (Number(current.quota_limit_bytes ?? 0) > 0
          ? Math.round(Number(current.quota_limit_bytes) / 1_000_000_000)
          : null),
      quota_limit_unit: dto.quota_limit_unit ?? 'GB',
    };

    const normalized = this.normalizeProfile(type, merged, group);
    await this.profiles.update(type, id, { name: merged.name, ...normalized });
    await this.syncRadius(type, id);
    await this.audit(actor, `${type}_profile.update`, { id, ...normalized });
    return this.profiles.findById(type, id);
  }

  async removeProfile(actor: Actor, type: ProfileType, id: number) {
    const profile = await this.getProfile(actor, type, id);
    const used = await this.profiles.voucherCount(type, id);
    if (used > 0) {
      throw new ConflictException(
        `Profil masih punya ${used} voucher. Hapus atau pindahkan voucher lebih dulu.`,
      );
    }
    const groupName = profile.radius_group ?? profile.name;
    await this.profiles.remove(type, id);
    // Grup RADIUS dengan nama profil ikut dibersihkan agar tidak tertinggal.
    await this.db.execute('DELETE FROM radgroupreply WHERE groupname = ?', [groupName]);
    await this.db.execute('DELETE FROM radgroupcheck WHERE groupname = ?', [groupName]);
    await this.audit(actor, `${type}_profile.delete`, { id, name: profile.name, radius_group: groupName });
    return { id, deleted: true };
  }

  private async assertProfileNameFree(
    ownerId: number,
    type: ProfileType,
    name: string,
    exceptId?: number,
  ) {
    const existing = await this.profiles.findByName(type, ownerId, name.trim(), exceptId);
    if (existing) {
      throw new ConflictException(`Nama profil "${name.trim()}" sudah dipakai.`);
    }
  }

  private async resolveGroup(
    actor: Actor,
    type: ProfileType,
    groupId: number,
  ): Promise<GroupProfileRow> {
    const group = await this.groups.findById(groupId);
    if (!group || !this.canAccess(group.owner_id, actor)) {
      throw new BadRequestException('Group Profile tidak ditemukan.');
    }
    if (group.type !== type) {
      throw new BadRequestException(
        `Group Profile bertipe ${group.type}, tidak bisa dipakai profil ${type}.`,
      );
    }
    return group;
  }

  /** Aturan bisnis yang ditegakkan di server, bukan hanya di form. */
  private normalizeProfile(
    type: ProfileType,
    dto: CreateServiceProfileDto,
    group: GroupProfileRow,
  ): Record<string, unknown> {
    // Harga kosong = gratis (0). Profil gratisan harus bisa disimpan tanpa
    // memaksa operator mengetik angka apa pun.
    const cost = Number(dto.cost_price ?? 0);
    const sell = Number(dto.sell_price ?? 0);
    const promo = Number(dto.promo_price ?? 0);
    const tax = Number(dto.tax_percent ?? 0);

    if (!Number.isFinite(cost) || cost < 0) throw new BadRequestException('Harga modal tidak boleh negatif.');
    if (!Number.isFinite(sell) || sell < 0) throw new BadRequestException('Harga jual tidak boleh negatif.');
    if (!Number.isFinite(promo)) throw new BadRequestException('Harga promo tidak valid.');
    if (promo < 0) throw new BadRequestException('Harga promo tidak boleh negatif.');
    if (promo > sell) throw new BadRequestException('Harga promo tidak boleh melebihi harga jual.');
    if (tax < 0 || tax > 100) throw new BadRequestException('PPN harus antara 0 dan 100%.');

    const shared = Number(dto.shared_users ?? 1);
    if (shared < 1) throw new BadRequestException('Shared user minimal 1.');

    const base: Record<string, unknown> = {
      cost_price: cost,
      sell_price: sell,
      promo_price: promo,
      tax_percent: tax,
      validity_value: Number(dto.validity_value ?? 0),
      validity_unit: dto.validity_unit ?? 'day',
      shared_users: shared,
      priority: Number(dto.priority ?? 1),
      login_days: dto.login_days && dto.login_days.length > 0 ? dto.login_days.join(',') : null,
      login_start: dto.login_start ?? null,
      login_end: dto.login_end ?? null,
      is_active: dto.is_active === undefined ? 1 : dto.is_active ? 1 : 0,
    };

    if (type === 'ppp') {
      // PPP tidak punya quota base. shared > 1 hanya boleh bila pool bukan sql-ippool,
      // karena satu IP dari pool tidak bisa dipakai beberapa sesi sekaligus.
      if (shared > 1 && group.pool_mode === 'sql-ippool') {
        throw new BadRequestException(
          'Shared user lebih dari 1 tidak diizinkan saat Group Profile memakai SQL-IP-POOL.',
        );
      }

      // Limitasi GRUP untuk PPP: disimpan dalam satuan pasti (detik/byte) agar
      // radgroupreply tidak bergantung pada satuan yang dipilih operator.
      const timeValue = Number(dto.time_limit_value ?? 0);
      const quotaValue = Number(dto.quota_limit_value ?? 0);
      return {
        ...base,
        time_limit_seconds:
          timeValue > 0 ? unitToSeconds(timeValue, dto.time_limit_unit ?? 'hour') : null,
        quota_limit_bytes: quotaValue > 0 ? quotaToBytes(quotaValue, dto.quota_limit_unit ?? 'GB') : null,
      };
    }

    const quotaType = dto.quota_type ?? 'unlimited';
    const timebaseValue = dto.timebase_value ?? null;
    const quotabaseValue = dto.quotabase_value ?? null;

    if (quotaType === 'unlimited') {
      if (shared > 1 && dto.login_days && dto.login_days.length === 0) {
        throw new BadRequestException('Periode login tidak valid.');
      }
      return {
        ...base,
        quota_type: 'unlimited',
        timebase_value: null,
        timebase_unit: null,
        quotabase_value: null,
        quotabase_unit: null,
      };
    }

    if (!timebaseValue && !quotabaseValue) {
      throw new BadRequestException(
        'Profil limited wajib punya batas waktu online (timebase) atau batas kuota (quotabase).',
      );
    }
    if (timebaseValue && !dto.timebase_unit) {
      throw new BadRequestException('Satuan timebase wajib dipilih.');
    }
    if (quotabaseValue && !dto.quotabase_unit) {
      throw new BadRequestException('Satuan quotabase wajib dipilih.');
    }

    // Shared > 1 hanya masuk akal untuk profil unlimited: akun berkuota
    // dibatasi volume, bukan jumlah perangkat.
    if (shared > 1) {
      throw new BadRequestException(
        'Shared user lebih dari 1 hanya untuk profil unlimited.',
      );
    }

    return {
      ...base,
      quota_type: 'limited',
      timebase_value: timebaseValue,
      timebase_unit: timebaseValue ? dto.timebase_unit : null,
      quotabase_value: quotabaseValue,
      quotabase_unit: quotabaseValue ? dto.quotabase_unit : null,
    };
  }

  // -------------------------------------------------------------------------
  // Sinkronisasi ke tabel grup RADIUS
  // -------------------------------------------------------------------------
  /** Menulis ulang radgroupreply/radgroupcheck untuk nama profil ini. */
  async syncRadius(type: ProfileType, id: number) {
    const profile = await this.profiles.findById(type, id);
    if (!profile) throw new NotFoundException('Profil tidak ditemukan.');
    const group = await this.groups.findById(Number(profile.group_profile_id));
    const bandwidth = await this.bandwidths.findById(Number(profile.bandwidth_id));
    if (!group || !bandwidth) throw new NotFoundException('Group/Bandwidth profil hilang.');

    const groupName = await this.resolveRadiusGroup(type, profile);
    const mapping = toRadiusMapping(profile, group, bandwidth);

    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radgroupreply WHERE groupname = ?', [groupName]);
      await connection.query('DELETE FROM radgroupcheck WHERE groupname = ?', [groupName]);
      for (const row of mapping.reply) {
        await connection.query(
          'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [groupName, row.attribute, row.op, row.value],
        );
      }
      for (const row of mapping.check) {
        await connection.query(
          'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [groupName, row.attribute, row.op, row.value],
        );
      }
    });

    return { groupname: groupName, ...mapping };
  }

  /**
   * Nama grup RADIUS harus unik global karena radgroupreply tidak mengenal
   * owner. Nama profil boleh kembar antar reseller, jadi bila bentrok grup
   * diberi akhiran "#<id>" dan hasilnya disimpan di kolom radius_group.
   */
  private async resolveRadiusGroup(
    type: ProfileType,
    profile: { id: number; name: string; radius_group: string | null },
  ) {
    let groupName = profile.name;
    if (profile.radius_group && profile.radius_group !== profile.name) {
      // Sudah pernah diberi akhiran; pertahankan agar voucher lama tetap valid.
      groupName = profile.radius_group;
    } else {
      const clash = await this.db.query<{ id: number }>(
        `SELECT id FROM hotspot_profiles WHERE name = ? AND id <> ?
         UNION SELECT id FROM ppp_profiles WHERE name = ? AND id <> ?
         LIMIT 1`,
        [profile.name, profile.id, profile.name, profile.id],
      );
      if (clash.length > 0) groupName = `${profile.name}#${profile.id}`;
    }

    if (groupName !== profile.radius_group) {
      // id hotspot dan id ppp bisa sama, jadi tabel ditentukan oleh `type`.
      const table = type === 'hotspot' ? 'hotspot_profiles' : 'ppp_profiles';
      await this.db.execute(`UPDATE ${table} SET radius_group = ? WHERE id = ?`, [
        groupName,
        profile.id,
      ]);
    }

    return groupName;
  }

  /**
   * Pratinjau atribut RADIUS untuk satu profil.
   *
   * Profil hotspot/PPP TIDAK menulis apa pun ke MikroTik: yang disimpan di sini
   * hanyalah penetapan grup, bandwidth, dan limitasi — seluruhnya atribut AAA.
   * Profil lokal di router hanya dibuat sekali oleh Group Profile.
   */
  async preview(actor: Actor, type: ProfileType, id: number) {
    const profile = await this.getProfile(actor, type, id);
    const group = await this.groups.findById(Number(profile.group_profile_id));
    const bandwidth = await this.bandwidths.findById(Number(profile.bandwidth_id));
    if (!group || !bandwidth) throw new NotFoundException('Group/Bandwidth profil hilang.');

    return {
      profile: { id: profile.id, name: profile.name, type },
      groupname: profile.name,
      radius: toRadiusMapping(profile, group, bandwidth),
      writes_to_router: false,
      group: {
        id: group.id,
        name: group.name,
        type: group.type,
        router_id: group.router_id,
        pool_mode: group.pool_mode,
        pool_name: group.mikrotik_pool_name,
        pool_range:
          group.pool_range_start && group.pool_range_end
            ? `${group.pool_range_start}-${group.pool_range_end}`
            : null,
        parent_queue: group.parent_queue,
        dns: [group.dns_primary, group.dns_secondary].filter(Boolean).join(','),
        // GROUP ONLY tidak membuat profil lokal, jadi tidak ada nama profil
        // yang bisa ditunjuk Mikrotik-Group.
        local_profile:
          group.use_router_default === 1 || group.pool_mode === 'group-pool' ? null : group.name,
      },
      price: finalPrice(profile),
      validity_seconds:
        Number(profile.validity_value) > 0
          ? unitToSeconds(Number(profile.validity_value), profile.validity_unit)
          : null,
    };
  }

  // -------------------------------------------------------------------------
  // Voucher
  // -------------------------------------------------------------------------
  /**
   * Daftar voucher. Reseller dipaksa melihat voucher miliknya saja — dipaksa
   * di server, bukan disaring di UI, supaya tidak bisa dilewati lewat query.
   */
  listVouchers(
    actor: Actor,
    filters: {
      profileType?: string;
      profileId?: number;
      status?: string;
      userType?: string;
      search?: string;
      createdBy?: number;
      ownerId?: number;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    },
  ) {
    const scoped = isResellerRole(actor.role) ? { ...filters, ownerId: actor.userId } : filters;
    return this.vouchers.list(scoped);
  }

  voucherCounts(actor: Actor) {
    return this.vouchers.counts(isResellerRole(actor.role) ? actor.userId : undefined);
  }

  async generateVouchers(actor: Actor, dto: GenerateVoucherDto) {
    const profile = await this.getProfile(actor, dto.profile_type, dto.profile_id);
    const price = finalPrice(profile);
    const rows: Array<Record<string, unknown>> = [];

    // Tipe member wajib menunjuk pelanggan nyata; tipe voucher tidak boleh.
    if (dto.user_type === 'member') {
      if (!dto.customer_id) {
        throw new BadRequestException('Tipe member wajib memilih pelanggan.');
      }
      const customer = await this.db.query<{ id: number }>(
        'SELECT id FROM customers WHERE id = ? AND is_active = 1',
        [dto.customer_id],
      );
      if (customer.length === 0) {
        throw new BadRequestException('Pelanggan tidak ditemukan atau tidak aktif.');
      }
    } else if (dto.customer_id) {
      throw new BadRequestException('Tipe voucher tidak boleh memiliki pelanggan.');
    }

    // Member dengan riwayat aktif tidak boleh punya dua akun di profil sama;
    // akun lama harus dinonaktifkan lebih dulu agar tidak dobel tagihan.
    if (dto.user_type === 'member' && dto.customer_id) {
      const existing = await this.db.query<{ id: number }>(
        `SELECT id FROM radius_vouchers
          WHERE user_type = 'member' AND customer_id = ?
            AND profile_type = ? AND status <> 'expired' LIMIT 1`,
        [dto.customer_id, dto.profile_type],
      );
      if (existing.length > 0) {
        throw new ConflictException(
          'Pelanggan ini sudah punya akun aktif pada tipe profil tersebut. ' +
            'Tandai kedaluwarsa lebih dulu bila ingin membuat ulang.',
        );
      }
    }

    for (let i = 0; i < dto.count; i += 1) {
      // Username dan password dijamin unik di dalam tabel (username UNIQUE).
      let username = '';
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = dto.username_prefix
          ? `${dto.username_prefix.toUpperCase()}${randomCode(Math.max(4, 12 - dto.username_prefix.length))}`
          : randomCode(8);
        if (!(await this.vouchers.findByUsername(candidate))) {
          username = candidate;
          break;
        }
      }
      if (!username) {
        throw new ConflictException('Gagal membuat username unik setelah beberapa percobaan.');
      }

      rows.push({
        profile_type: dto.profile_type,
        profile_id: profile.id,
        group_profile_id: Number(profile.group_profile_id),
        profile_name: profile.name,
        user_type: dto.user_type,
        username,
        // Voucher: username = password (dibagikan di kertas, satu kali pakai).
        // Member: password terpisah, boleh ditentukan operator.
        password:
          dto.user_type === 'voucher' ? username : (dto.password ?? randomCode(8)),
        customer_id: dto.user_type === 'member' ? dto.customer_id : null,
        // Member adalah akun langganan yang langsung diserahkan; voucher
        // masih berstatus baru sampai diserahkan ke pembeli.
        status: dto.user_type === 'member' || dto.ready ? 'ready-to-use' : 'new-created',
        price: price.base,
        tax_amount: price.tax,
        created_by: actor.userId,
        // Voucher mewarisi pemilik PROFIL-nya: reseller harus bisa mencetak
        // voucher dari profilnya sendiri walau yang mencetak operator.
        owner_id: profile.owner_id ?? null,
      });
    }

    const created = await this.vouchers.createBatch(rows);

    // Pastikan grup RADIUS untuk profil ini sudah ditulis dan dapat nama final
    // (bisa "nama#id" bila nama profil bentrok antar reseller).
    const synced = await this.syncRadius(dto.profile_type, profile.id);

    // Tulis akun ke FreeRADIUS: radcheck (password) + radusergroup (profil).
    // Grup RADIUS sudah dibuat saat profil disimpan, jadi di sini hanya
    // menghubungkan user ke grup dengan nama profil.
    for (const row of rows) {
      await this.writeRadiusAccount(
        String(row.username),
        String(row.password),
        synced.groupname,
      );
    }

    await this.audit(actor, 'voucher.generate', {
      profile: profile.name,
      count: created,
      type: dto.profile_type,
      user_type: dto.user_type,
      customer_id: dto.customer_id ?? null,
    });
    return {
      created,
      profile: profile.name,
      user_type: dto.user_type,
      total_price: price.total * created,
    };
  }

  /**
   * Menulis akun ke tabel RADIUS.
   * radcheck  → Cleartext-Password (dipakai modul pap)
   * radusergroup → grup dengan nama profil (atribut grup sudah ada di radgroupreply)
   * radreply  → dibersihkan agar tidak ada sisa atribut lama.
   */
  async writeRadiusAccount(username: string, password: string, groupname: string) {
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radcheck WHERE username = ?', [username]);
      await connection.query('DELETE FROM radreply WHERE username = ?', [username]);
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value)
         VALUES (?, 'Cleartext-Password', ':=', ?)`,
        [username, password],
      );
      await connection.query(
        'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
        [username, groupname],
      );
    });
  }

  /** Mencabut akun dari RADIUS agar tidak bisa login lagi. */
  async removeRadiusAccount(username: string) {
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radcheck WHERE username = ?', [username]);
      await connection.query('DELETE FROM radreply WHERE username = ?', [username]);
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    });
  }

  /**
   * Aktivasi voucher: masa aktif mulai dihitung dari LOGIN PERTAMA.
   * Dipanggil saat voucher pertama kali dipakai.
   */
  async activateVoucher(actor: Actor, id: number) {
    const voucher = await this.vouchers.findById(id);
    if (!voucher) throw new NotFoundException(`Voucher #${id} tidak ditemukan.`);
    if (voucher.status === 'expired') {
      throw new ConflictException('Voucher sudah kedaluwarsa.');
    }
    if (voucher.first_login_at) {
      return voucher; // sudah pernah aktif, jangan hitung ulang
    }

    const profile = await this.profiles.findById(voucher.profile_type, Number(voucher.profile_id));
    if (!profile) throw new NotFoundException('Profil voucher tidak ditemukan.');

    const seconds =
      Number(profile.validity_value) > 0
        ? unitToSeconds(Number(profile.validity_value), profile.validity_unit)
        : 0;

    await this.vouchers.update(id, {
      status: 'active',
      first_login_at: new Date(),
      // 0 menit/hari = tanpa batas → expires_at tetap NULL.
      expires_at: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
    });
    // Pastikan akun RADIUS ada: bisa saja sempat dicabut saat status expired.
    await this.writeRadiusAccount(
      voucher.username,
      voucher.password,
      profile.radius_group ?? profile.name,
    );
    await this.audit(actor, 'voucher.activate', { id, seconds });
    return this.vouchers.findById(id);
  }

  async setVoucherStatus(actor: Actor, id: number, status: string) {
    const voucher = await this.vouchers.findById(id);
    if (!voucher) throw new NotFoundException(`Voucher #${id} tidak ditemukan.`);

    // Expired = akun tidak boleh login lagi, jadi akunnya dicabut dari RADIUS.
    // Status lain menulis ulang akun agar bisa dipakai kembali.
    if (status === 'expired') {
      await this.removeRadiusAccount(voucher.username);
    } else if (voucher.status === 'expired') {
      const profile = await this.profiles.findById(
        voucher.profile_type,
        Number(voucher.profile_id),
      );
      await this.writeRadiusAccount(
        voucher.username,
        voucher.password,
        profile?.radius_group ?? voucher.profile_name,
      );
    }

    await this.vouchers.update(id, { status });
    await this.audit(actor, 'voucher.status', { id, from: voucher.status, to: status });
    return this.vouchers.findById(id);
  }

  /**
   * Ambil voucher berdasarkan id, TERBATAS pada cakupan akun.
   *
   * Semua aksi massal (ubah status, hapus, cetak, ekspor, kirim WhatsApp)
   * lewat sini supaya reseller tidak bisa menyentuh voucher milik akun lain
   * hanya dengan menebak id.
   */
  private async vouchersForAction(actor: Actor, ids: number[]) {
    const unique = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (unique.length === 0) {
      throw new BadRequestException('Tidak ada voucher yang dipilih.');
    }
    const rows = await this.vouchers.list({
      limit: 500,
      ownerId: isResellerRole(actor.role) ? actor.userId : undefined,
    });
    const picked = rows.filter((row) => unique.includes(row.id));
    if (picked.length === 0) {
      throw new NotFoundException('Voucher yang dipilih tidak ditemukan pada akun Anda.');
    }
    return picked;
  }

  async removeVouchers(actor: Actor, ids: number[]) {
    const picked = await this.vouchersForAction(actor, ids);
    // Cabut dulu akun RADIUS-nya supaya tidak ada user "hantu" yang masih bisa
    // login padahal barisnya sudah dihapus dari panel.
    for (const row of picked) {
      await this.removeRadiusAccount(row.username);
    }
    const removed = await this.vouchers.removeByIds(picked.map((row) => row.id));
    await this.audit(actor, 'voucher.delete', { ids: picked.map((row) => row.id), removed });
    return { removed };
  }

  /** Ubah status banyak voucher sekaligus (aktifkan / tandai kedaluwarsa). */
  async bulkVoucherStatus(actor: Actor, ids: number[], status: string) {
    const picked = await this.vouchersForAction(actor, ids);
    let changed = 0;
    for (const row of picked) {
      await this.setVoucherStatus(actor, row.id, status);
      changed += 1;
    }
    return { changed, status };
  }

  /** Baris voucher untuk ekspor CSV/PDF & pengiriman WhatsApp. */
  async voucherRowsForExport(actor: Actor, ids?: number[]) {
    if (ids && ids.length > 0) return this.vouchersForAction(actor, ids);
    return this.vouchers.list({
      limit: 500,
      ownerId: isResellerRole(actor.role) ? actor.userId : undefined,
    });
  }

  /** Kartu voucher untuk PDF: satu kartu per akun. */
  static toCards(rows: Array<{ profile_name: string; username: string; password: string; user_type: string; status: string }>): VoucherCard[] {
    return rows.map((row) => ({
      profile: row.profile_name,
      username: row.username,
      password: row.password,
      meta: `${row.user_type === 'member' ? 'member' : 'voucher'} · ${row.status}`,
    }));
  }

  buildVoucherPdf(cards: VoucherCard[]): Buffer {
    return buildVoucherPdf(cards);
  }

  /**
   * Kirim voucher terpilih ke WhatsApp.
   *
   * Nomor diambil dari: parameter `phone` bila diisi, kalau tidak dari nomor
   * pelanggan akun member. Voucher lepas tanpa nomor akan dilewati dan
   * dilaporkan — tidak dikirim ke nomor tebakan.
   */
  async sendVouchersWhatsApp(actor: Actor, ids: number[], phone?: string) {
    const picked = await this.vouchersForAction(actor, ids);
    if (picked.length > 50) {
      throw new BadRequestException(
        `Maksimal 50 voucher sekali kirim (dipilih ${picked.length}). Persempit pilihan.`,
      );
    }

    // Nomor pelanggan untuk akun member, supaya satu pelanggan satu pesan.
    const customers = await this.db.query<{ id: number; phone: string | null; name: string }>(
      'SELECT id, phone, name FROM customers WHERE id IN (?)',
      [picked.map((row) => row.customer_id).filter((id): id is number => Boolean(id)).concat([0])],
    );
    const phoneByCustomer = new Map(customers.map((row) => [Number(row.id), row.phone ?? '']));

    const sent: string[] = [];
    const skipped: string[] = [];
    let pdfAttached = false;
    let note: string | undefined;

    for (const row of picked) {
      const target =
        (phone ?? '').trim() ||
        (row.customer_id ? phoneByCustomer.get(Number(row.customer_id)) ?? '' : '');
      if (!target) {
        skipped.push(row.username);
        continue;
      }

      const caption =
        `Voucher ${row.profile_name}\n` +
        `Username: ${row.username}\n` +
        `Password: ${row.password}\n` +
        `Berlaku: mulai login pertama.`;

      const result = await this.whatsapp.sendDocument({
        phone: target,
        caption,
        filename: `voucher-${row.username}.pdf`,
        pdf: buildVoucherPdf(ProfilesService.toCards([row])),
      });
      pdfAttached = result.pdf_attached;
      note = result.note;
      sent.push(row.username);
    }

    await this.audit(actor, 'voucher.send_whatsapp', {
      ids: picked.map((row) => row.id),
      sent: sent.length,
      skipped: skipped.length,
    });

    return {
      sent: sent.length,
      skipped: skipped.length,
      skipped_usernames: skipped.slice(0, 20),
      pdf_attached: pdfAttached,
      note,
      message:
        `${sent.length} voucher dikirim` +
        (skipped.length > 0
          ? `, ${skipped.length} dilewati karena tidak ada nomor WhatsApp (isi nomor pelanggan atau kirim satu per satu dengan nomor).`
          : '.'),
    };
  }

  /** Menandai voucher yang masa aktifnya lewat sebagai expired. */
  async expireOverdue() {
    const rows = await this.vouchers.overdue();
    for (const row of rows) {
      await this.removeRadiusAccount(row.username);
      await this.vouchers.update(row.id, { status: 'expired' });
    }
    if (rows.length > 0) this.logger.log(`${rows.length} voucher ditandai expired`);
    return { expired: rows.length };
  }

  private async audit(actor: Actor, action: string, details: Record<string, unknown>) {
    await this.db
      .execute('INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)', [
        actor.userId,
        action,
        JSON.stringify(details),
        actor.ip,
      ])
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit ${action} gagal: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}

/** IPv4 bertitik → bilangan bulat; null bila tidak valid. */
export function ipToInt(value: string): number | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

/**
 * Nama IP pool yang dibuat panel untuk sebuah grup. Deterministik supaya
 * penghapusan dan penyiapan ulang selalu menunjuk objek yang sama.
 * RouterOS membatasi nama objek 64 karakter.
 */
export function poolNameFor(groupName: string): string {
  const slug = groupName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `jw-${slug || 'pool'}`.slice(0, 64);
}

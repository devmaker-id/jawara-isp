import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  PreconditionFailedException,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateNasDto,
  ListNasQueryDto,
  ListAuthLogQueryDto,
  UpdateNasDto,
  UsageLookupQueryDto,
} from './dto/radius.dto';
import {
  InstallConflictError,
  InstallNotReadyError,
  RadiusInstallService,
} from './radius-install.service';
import { RadiusConfigDto, RadiusServiceActionDto } from './dto/radius-config.dto';
import { AssignGroupDto, SaveGroupDto } from './dto/radius-group.dto';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { compareGroups, ParityRow } from './group-parity';
import {
  RadiusConfigNotReadyError,
  RadiusConfigRejectedError,
  RadiusConfigService,
} from './radius-config.service';
import { RadiusEnforcementService } from './radius-enforcement.service';
import { IsolirService } from './isolir.service';
import {
  IsolateUserDto,
  ProvisionIsolirDto,
  ReleaseUserDto,
  UpdateIsolirDto,
} from './dto/isolir.dto';
import { RadiusService } from './radius.service';

const radiusValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

interface Actor {
  userId: number;
  ip: string;
}

const actorOf = (request: Request): Actor => {
  const user = (request as Request & { user?: { sub?: number } }).user;
  return { userId: Number(user?.sub ?? 0), ip: request.ip ?? '' };
};

// FreeRADIUS: NAS (dari MikroTik), user radcheck, dan sesi radacct.
// Semua operasi baca admin/operator; mutasi admin saja. Bila tabel rad*
// belum ada, setiap endpoint mengembalikan 503 dengan pesan yang jelas.
@Controller('freeradius')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UsePipes(radiusValidation)
export class RadiusController {
  constructor(
    private readonly radius: RadiusService,
    private readonly install: RadiusInstallService,
    private readonly config: RadiusConfigService,
    private readonly mikrotik: MikrotikService,
    private readonly enforcement: RadiusEnforcementService,
    private readonly isolir: IsolirService,
  ) {}

  @Get('status')
  @Roles('admin', 'operator')
  async status() {
    const status = await this.radius.status();
    // Dipisah jelas: `installed` = skema tabel, `server` = paket FreeRADIUS
    // di server. Panel tidak menyamakan keduanya.
    return { ...status, server: this.install.probe(), server_state: this.install.state() };
  }

  // ---- Pemasangan FreeRADIUS (khusus admin) --------------------------------
  // Pemeriksaan baca-saja: tidak mengubah apa pun.
  @Get('install')
  @Roles('admin')
  installStatus() {
    return { ...this.install.state(), probe: this.install.probe() };
  }

  // Menjalankan satu file tetap sebagai root lewat sudo sempit.
  // Tidak ada parameter yang diterima dari klien.
  @Post('install')
  @Roles('admin')
  async startInstall(@Req() request: Request) {
    try {
      return await this.install.start(actorOf(request));
    } catch (error) {
      if (error instanceof InstallConflictError) throw new ConflictException(error.message);
      if (error instanceof InstallNotReadyError)
        throw new PreconditionFailedException(error.message);
      throw error;
    }
  }

  // Polling log berbasis offset (bukan SSE) agar tidak di-buffer Cloudflare.
  @Get('install/log')
  @Roles('admin')
  installLog(@Query('offset') offset?: string) {
    const parsed = Number(offset ?? 0);
    return this.install.log(Number.isFinite(parsed) ? parsed : 0);
  }

  // ---- Konfigurasi FreeRADIUS (khusus admin) -------------------------------
  // Semua endpoint di bawah memakai helper sudo sempit; tidak ada path atau
  // perintah bebas dari klien.
  @Get('config')
  @Roles('admin')
  async readConfig() {
    try {
      const current = await this.config.read();
      return { ...current, helper_installed: this.config.available() };
    } catch (error) {
      throw this.mapConfigError(error);
    }
  }

  @Post('config')
  @Roles('admin')
  async applyConfig(@Body() dto: RadiusConfigDto) {
    try {
      // Nilai yang tidak dikirim dipertahankan seperti sekarang.
      const current = await this.config.read();
      const merged = { ...current.settings, ...this.definedFields(dto) };
      return await this.config.apply(merged);
    } catch (error) {
      throw this.mapConfigError(error);
    }
  }

  @Post('config/validate')
  @Roles('admin')
  async validateConfig() {
    try {
      return await this.config.validate();
    } catch (error) {
      throw this.mapConfigError(error);
    }
  }

  @Post('config/service')
  @Roles('admin')
  async controlService(@Body() dto: RadiusServiceActionDto) {
    try {
      return await this.config.control(dto.action);
    } catch (error) {
      throw this.mapConfigError(error);
    }
  }

  // Diagnostik: menjalankan freeradius -X ~10 detik (service dihentikan
  // sementara oleh helper, lalu dinyalakan kembali).
  @Post('config/debug')
  @Roles('admin')
  async debugConfig() {
    try {
      return await this.config.debug();
    } catch (error) {
      throw this.mapConfigError(error);
    }
  }

  private definedFields(dto: RadiusConfigDto): Partial<RadiusConfigDto> {
    return Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<RadiusConfigDto>;
  }

  // Galat helper diterjemahkan ke status HTTP yang tepat, bukan 500 buta.
  private mapConfigError(error: unknown): Error {
    if (error instanceof RadiusConfigRejectedError) {
      const detail = error.validation.length > 0 ? ` ${error.validation.slice(-3).join(' | ')}` : '';
      return new PreconditionFailedException(`${error.message}${detail}`);
    }
    if (error instanceof RadiusConfigNotReadyError) {
      return new PreconditionFailedException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  @Get('nas')
  @Roles('admin', 'operator')
  listNas(@Query() query: ListNasQueryDto) {
    return this.radius.listNas(query);
  }

  // Perangkat MikroTik yang bisa dipilih sebagai NAS.
  @Get('nas/candidates')
  @Roles('admin', 'operator')
  nasCandidates() {
    return this.radius.nasCandidates();
  }

  // Pemeriksaan baca-saja sebelum NAS disimpan (jam, jangkauan, /radius).
  @Get('nas/preflight')
  @Roles('admin', 'operator')
  nasPreflight(@Query('device_id', ParseIntPipe) deviceId: number) {
    return this.radius.nasPreflight(deviceId);
  }

  @Post('nas')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createNas(@Body() dto: CreateNasDto) {
    return this.radius.createNas(dto);
  }

  @Patch('nas/:id')
  @Roles('admin')
  updateNas(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateNasDto) {
    return this.radius.updateNas(id, dto);
  }

  @Delete('nas/:id')
  @Roles('admin')
  deleteNas(@Param('id', ParseIntPipe) id: number) {
    return this.radius.deleteNas(id);
  }

  // Akun RADIUS tidak lagi dikelola di sini. Satu-satunya penulis radcheck/
  // radusergroup adalah Layanan → Voucher, supaya tipe layanan, profil, dan
  // bandwidth selalu terhubung. Yang tersisa di modul ini hanya baca + penegakan.
  @Post('enforce')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  enforce() {
    return this.enforcement.enforce();
  }

  @Get('sessions')
  @Roles('admin', 'operator')
  sessions(@Query('limit') limit?: string) {
    return this.radius.sessions(limit);
  }

  @Get('auth-log')
  @Roles('admin', 'operator')
  authLog(@Query() query: ListAuthLogQueryDto) {
    return this.radius.authLog(query);
  }

  @Get('accounting')
  @Roles('admin', 'operator')
  accounting(@Query('limit') limit?: string) {
    return this.radius.accounting(limit);
  }

  // Cek pemakaian user — terbuka untuk semua role (admin, operator, reseller)
  // karena hanya membaca identitas layanan + angka pemakaian dari radacct.
  @Get('usage')
  @Roles('admin', 'operator', 'resseler')
  usage(@Query() query: UsageLookupQueryDto) {
    return this.radius.usageLookup(query);
  }

  // ---- Profil isolir -------------------------------------------------------
  // Dipakai PPPoE yang kehabisan batas waktu/kuota atau menunggak: grup RADIUS
  // dipindah ke ISOLIR sehingga ia mendapat IP 10.127.0.0/18 dan hanya bisa
  // membuka halaman isolir.
  @Get('isolir')
  @Roles('admin', 'operator')
  statusIsolir() {
    return this.isolir.status();
  }

  @Put('isolir')
  @Roles('admin')
  saveIsolir(@Body() dto: UpdateIsolirDto) {
    return this.isolir.saveConfig(dto);
  }

  // Menulis atribut grup ISOLIR ke radgroupreply (Framed-Pool, rate limit, DNS).
  @Post('isolir/sync')
  @Roles('admin')
  syncIsolir() {
    return this.isolir.syncGroupAttributes();
  }

  // Menyiapkan /ip/pool + /ppp/profile isolir di satu perangkat.
  @Post('isolir/provision')
  @Roles('admin')
  async provisionIsolir(@Body() dto: ProvisionIsolirDto) {
    const group = await this.isolir.ensureGroupRow(dto.device_id);
    const provisioning = await this.isolir.provisionDevice(dto.device_id);
    return { group_profile_id: group, provisioning };
  }

  // Perintah firewall/redirect untuk dipasang operator (tidak dijalankan panel).
  @Get('isolir/commands')
  @Roles('admin', 'operator')
  isolirCommands() {
    return this.isolir.deviceCommands();
  }

  @Post('isolir/isolate')
  @Roles('admin', 'operator')
  isolate(@Body() dto: IsolateUserDto) {
    return this.isolir.isolate(dto.username, dto.reason ?? 'bill');
  }

  @Post('isolir/release')
  @Roles('admin', 'operator')
  release(@Body() dto: ReleaseUserDto) {
    return this.isolir.release(dto.username);
  }

  // ---- Grup RADIUS ---------------------------------------------------------
  // Atribut grup disimpan di radgroupreply/radgroupcheck dan dipakai bersama
  // oleh FreeRADIUS maupun profile MikroTik.
  @Get('groups')
  @Roles('admin', 'operator')
  listGroups(@Query('search') search?: string) {
    return this.radius.listGroups(search);
  }

  // Perbandingan grup RADIUS vs profil MikroTik (read-only, tidak mengubah
  // apa pun di router). Diletakkan sebelum :groupname agar tidak tertangkap
  // sebagai nama grup.
  @Get('parity')
  @Roles('admin', 'operator')
  async parity(
    @Query('source') source?: string,
    @Query('device') device?: string,
  ): Promise<{
    source: 'hotspot' | 'ppp';
    device: number | null;
    rows: ParityRow[];
    summary: Record<string, number>;
    error?: string;
  }> {
    const which: 'hotspot' | 'ppp' = source === 'ppp' ? 'ppp' : 'hotspot';
    const deviceId = device ? Number(device) : undefined;

    const groups = await this.radius.listGroups();
    let profiles: Array<{ name: string; rate_limit: string | null; session_timeout?: string | null; shared_users?: string | null }> = [];
    let error: string | undefined;

    try {
      const raw =
        which === 'hotspot'
          ? await this.mikrotik.hotspotUserProfiles()
          : await this.mikrotik.pppProfiles();
      profiles = raw.map((profile) => ({
        name: profile.name,
        rate_limit: profile.rate_limit ?? null,
        session_timeout: 'session_timeout' in profile ? profile.session_timeout : null,
        shared_users: 'shared_users' in profile ? profile.shared_users : null,
      }));
    } catch (caught) {
      // Router tidak terjangkau bukan alasan menggagalkan seluruh halaman:
      // sisi RADIUS tetap ditampilkan, masalah router dilaporkan terpisah.
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const rows = compareGroups(groups, profiles);
    const summary = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});

    return { source: which, device: deviceId ?? null, rows, summary, error };
  }

  @Get('groups/:groupname')
  @Roles('admin', 'operator')
  getGroup(@Param('groupname') groupname: string) {
    return this.radius.getGroup(groupname);
  }

  @Post('groups')
  @Roles('admin')
  saveGroup(@Body() dto: SaveGroupDto, @Req() request: Request) {
    return this.radius.saveGroup(dto, actorOf(request));
  }

  @Delete('groups/:groupname')
  @Roles('admin')
  deleteGroup(@Param('groupname') groupname: string, @Req() request: Request) {
    return this.radius.deleteGroup(groupname, actorOf(request));
  }

  // Memindahkan user ke grup lain dari halaman grup.
  @Post('groups/assign')
  @Roles('admin')
  assignGroup(@Body() dto: AssignGroupDto, @Req() request: Request) {
    return this.radius.assignUser(dto, actorOf(request));
  }
}
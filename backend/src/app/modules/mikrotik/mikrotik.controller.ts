import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device.dto';
import {
  HotspotUserDto,
  InterfaceUpdateDto,
  PppSecretDto,
  UpdateHotspotUserDto,
  UpdatePppSecretDto,
} from './dto/mikrotik.dto';
import { MikrotikService } from './mikrotik.service';

const mikrotikValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

interface Actor {
  userId: number;
  ip: string;
}

// id RouterOS berbentuk "*1A" sehingga tidak bisa ParseIntPipe.
const actorOf = (request: Request): Actor => {
  const user = (request as Request & { user?: { sub?: number } }).user;
  return {
    userId: Number(user?.sub ?? 0),
    ip: request.ip ?? request.socket?.remoteAddress ?? '',
  };
};

// Integrasi perangkat MikroTik lewat RouterOS API (TCP biner, port 1998).
// Semua endpoint hanya baca kecuali yang ditandai; tulis butuh
// "write_enabled" perangkat DAN role admin.
//
// Daftar perangkat (multi-router) ada di /mikrotik/devices; endpoint data
// menerima ?device=<id> untuk memilih router. Tanpa parameter itu dipakai
// perangkat aktif pertama, atau konfigurasi tunggal lama bila daftar kosong.
@Controller('mikrotik')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UsePipes(mikrotikValidation)
export class MikrotikController {
  constructor(private readonly mikrotik: MikrotikService) {}

  private deviceId(raw?: string): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  // ===== daftar perangkat =====
  @Get('devices')
  @Roles('admin', 'operator')
  devices() {
    return this.mikrotik.listDevices();
  }

  @Post('devices')
  @Roles('admin')
  @RequirePermission('device.create')
  @HttpCode(HttpStatus.CREATED)
  createDevice(@Body() dto: CreateDeviceDto, @Req() request: Request) {
    return this.mikrotik.createDevice(dto, actorOf(request));
  }

  @Patch('devices/:id')
  @Roles('admin')
  @RequirePermission('device.update')
  updateDevice(@Param('id') id: string, @Body() dto: UpdateDeviceDto, @Req() request: Request) {
    return this.mikrotik.updateDevice(this.deviceId(id) as number, dto, actorOf(request));
  }

  @Delete('devices/:id')
  @Roles('admin')
  @RequirePermission('device.delete')
  deleteDevice(@Param('id') id: string, @Req() request: Request) {
    return this.mikrotik.deleteDevice(this.deviceId(id) as number, actorOf(request));
  }

  @Post('devices/:id/test')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  testDevice(@Param('id') id: string, @Req() request: Request) {
    return this.mikrotik.testDevice(this.deviceId(id) as number, actorOf(request));
  }

  // ===== baca: ringkasan & resource =====
  @Get('status')
  @Roles('admin', 'operator')
  status(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.status());
  }

  @Get('resources')
  @Roles('admin', 'operator')
  resources(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.resources());
  }

  @Get('interfaces')
  @Roles('admin', 'operator')
  interfaces(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.interfaces());
  }

  // Traffic satu interface untuk ditampilkan realtime di panel.
  // Read-only: hanya memanggil /interface/monitor-traffic dengan =once=.
  @Get('interfaces/:name/traffic')
  @Roles('admin', 'operator')
  interfaceTraffic(@Param('name') name: string, @Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.interfaceTraffic(name),
    );
  }

  @Patch('interfaces/:name')
  @Roles('admin')
  setInterface(
    @Param('name') name: string,
    @Body() dto: InterfaceUpdateDto,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.setInterfaceDisabled(name, dto, actorOf(request)),
    );
  }

  // ===== hotspot =====
  @Get('hotspot/servers')
  @Roles('admin', 'operator')
  hotspotServers(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.hotspotServers(),
    );
  }

  @Get('hotspot/profiles')
  @Roles('admin', 'operator')
  hotspotProfiles(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.hotspotProfiles(),
    );
  }

  // Profil user hotspot: sumber rate-limit/shared-users yang dipakai
  // bersama dengan grup RADIUS (Mikrotik-Rate-Limit).
  @Get('hotspot/user-profiles')
  @Roles('admin', 'operator')
  hotspotUserProfiles(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.hotspotUserProfiles(),
    );
  }

  @Get('hotspot/users')
  @Roles('admin', 'operator')
  hotspotUsers(
    @Query('search') search?: string,
    @Query('profile') profile?: string,
    @Query('server') server?: string,
    @Query('disabled') disabled?: 'yes' | 'no',
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.hotspotUsers({ search, profile, server, disabled }),
    );
  }

  @Post('hotspot/users')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createHotspotUser(
    @Body() dto: HotspotUserDto,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.createHotspotUser(dto, actorOf(request)),
    );
  }

  @Patch('hotspot/users/:id')
  @Roles('admin')
  updateHotspotUser(
    @Param('id') id: string,
    @Body() dto: UpdateHotspotUserDto,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.updateHotspotUser(id, dto, actorOf(request)),
    );
  }

  @Delete('hotspot/users/:id')
  @Roles('admin')
  deleteHotspotUser(
    @Param('id') id: string,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.deleteHotspotUser(id, actorOf(request)),
    );
  }

  @Get('hotspot/active')
  @Roles('admin', 'operator')
  hotspotActive(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.hotspotActive(),
    );
  }

  // ===== ppp =====
  @Get('ppp/profiles')
  @Roles('admin', 'operator')
  pppProfiles(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.pppProfiles());
  }

  @Get('ppp/secrets')
  @Roles('admin', 'operator')
  pppSecrets(
    @Query('search') search?: string,
    @Query('service') service?: string,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.pppSecrets({ search, service }),
    );
  }

  @Post('ppp/secrets')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createPppSecret(
    @Body() dto: PppSecretDto,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.createPppSecret(dto, actorOf(request)),
    );
  }

  @Patch('ppp/secrets/:id')
  @Roles('admin')
  updatePppSecret(
    @Param('id') id: string,
    @Body() dto: UpdatePppSecretDto,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.updatePppSecret(id, dto, actorOf(request)),
    );
  }

  @Delete('ppp/secrets/:id')
  @Roles('admin')
  deletePppSecret(
    @Param('id') id: string,
    @Req() request: Request,
    @Query('device') device?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.deletePppSecret(id, actorOf(request)),
    );
  }

  @Get('ppp/active')
  @Roles('admin', 'operator')
  pppActive(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.pppActive());
  }

  // ===== log aktivitas =====
  @Get('logs')
  @Roles('admin', 'operator')
  logs(
    @Query('device') device?: string,
    @Query('topics') topics?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.logs({
        topics,
        search,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  }

  // ===== routing =====
  @Get('routing/routes')
  @Roles('admin', 'operator')
  routingRoutes(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.routingRoutes());
  }

  @Get('routing/neighbors')
  @Roles('admin', 'operator')
  routingNeighbors(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () =>
      this.mikrotik.routingNeighbors(),
    );
  }

  @Get('routing/arp')
  @Roles('admin', 'operator')
  routingArp(@Query('device') device?: string) {
    return this.mikrotik.runWithDevice(this.deviceId(device), () => this.mikrotik.routingArp());
  }
}

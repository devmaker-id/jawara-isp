import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateBandwidthDto,
  CreateGroupProfileDto,
  CreateServiceProfileDto,
  GenerateVoucherDto,
  ListVoucherQueryDto,
  RemoveVouchersDto,
  UpdateBandwidthDto,
  UpdateGroupProfileDto,
  UpdateServiceProfileDto,
  UpdateVoucherStatusDto,
} from './dto/profiles.dto';
import { ProfilesService } from './profiles.service';

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

type Actor = { userId: number; ip: string; role?: string };

// role diambil dari akun terautentikasi (sudah divalidasi JwtAuthGuard terhadap
// database), bukan dari header/body.
const actorOf = (request: Request): Actor => {
  const user = (request as Request & { user?: { sub?: number; role?: string } }).user;
  return {
    userId: Number(user?.sub ?? 0),
    ip: request.ip ?? '',
    role: user?.role,
  };
};

// Bandwidth, Group Profile, Profile Hotspot/PPP, dan Voucher.
// Baca: admin & operator. Mutasi: admin saja (reseller belum punya kepemilikan
// data yang terpisah, jadi belum diberi akses tulis).
@Controller('profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(validation)
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}

  private typeOf(value: string): 'hotspot' | 'ppp' {
    if (value !== 'hotspot' && value !== 'ppp') {
      throw new BadRequestException('Type profil harus hotspot atau ppp.');
    }
    return value;
  }

  // ===== Bandwidth =====
  @Get('bandwidth')
  @Roles('admin', 'operator')
  bandwidths(@Req() request: Request, @Query('search') search?: string) {
    return this.service.listBandwidths(actorOf(request), search);
  }

  @Post('bandwidth')
  @Roles('admin')
  createBandwidth(@Req() request: Request, @Body() dto: CreateBandwidthDto) {
    return this.service.createBandwidth(actorOf(request), dto);
  }

  @Patch('bandwidth/:id')
  @Roles('admin')
  updateBandwidth(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBandwidthDto,
  ) {
    return this.service.updateBandwidth(actorOf(request), id, dto);
  }

  @Delete('bandwidth/:id')
  @Roles('admin')
  removeBandwidth(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeBandwidth(actorOf(request), id);
  }

  // ===== Group Profile =====
  @Get('groups')
  @Roles('admin', 'operator')
  groups(
    @Req() request: Request,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listGroups(actorOf(request), type, search);
  }

  @Get('groups/:id')
  @Roles('admin', 'operator')
  group(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.getGroup(actorOf(request), id);
  }

  @Post('groups')
  @Roles('admin')
  createGroup(@Req() request: Request, @Body() dto: CreateGroupProfileDto) {
    return this.service.createGroup(actorOf(request), dto);
  }

  @Patch('groups/:id')
  @Roles('admin')
  updateGroup(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupProfileDto,
  ) {
    return this.service.updateGroup(actorOf(request), id, dto);
  }

  @Delete('groups/:id')
  @Roles('admin')
  removeGroup(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeGroup(actorOf(request), id);
  }

  // ===== Profil Hotspot / PPP =====
  @Get('hotspot')
  @Roles('admin', 'operator')
  hotspot(@Req() request: Request, @Query('search') search?: string) {
    return this.service.listProfiles(actorOf(request), 'hotspot', search);
  }

  @Get('ppp')
  @Roles('admin', 'operator')
  ppp(@Req() request: Request, @Query('search') search?: string) {
    return this.service.listProfiles(actorOf(request), 'ppp', search);
  }

  @Get(':type/:id/preview')
  @Roles('admin', 'operator')
  preview(
    @Req() request: Request,
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.preview(actorOf(request), this.typeOf(type), id);
  }

  @Get(':type/:id')
  @Roles('admin', 'operator')
  profile(
    @Req() request: Request,
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.getProfile(actorOf(request), this.typeOf(type), id);
  }

  @Post(':type')
  @Roles('admin')
  createProfile(
    @Req() request: Request,
    @Param('type') type: string,
    @Body() dto: CreateServiceProfileDto,
  ) {
    return this.service.createProfile(actorOf(request), this.typeOf(type), dto);
  }

  @Patch(':type/:id')
  @Roles('admin')
  updateProfile(
    @Req() request: Request,
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceProfileDto,
  ) {
    return this.service.updateProfile(actorOf(request), this.typeOf(type), id, dto);
  }

  @Delete(':type/:id')
  @Roles('admin')
  removeProfile(
    @Req() request: Request,
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.removeProfile(actorOf(request), this.typeOf(type), id);
  }

  // Tulis ulang grup RADIUS untuk profil ini (dipakai bila data berubah manual).
  @Post(':type/:id/sync-radius')
  @Roles('admin')
  syncRadius(
    @Req() request: Request,
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    // getProfile memastikan kepemilikan sebelum menulis.
    return this.service
      .getProfile(actorOf(request), this.typeOf(type), id)
      .then(() => this.service.syncRadius(this.typeOf(type), id));
  }
}

// Voucher dipisah endpoint-nya agar mudah dipakai halaman cetak voucher.
@Controller('vouchers')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(validation)
export class VouchersController {
  constructor(private readonly service: ProfilesService) {}

  @Get()
  @Roles('admin', 'operator')
  list(@Query() query: ListVoucherQueryDto) {
    return this.service.listVouchers({
      profileType: query.profile_type,
      userType: query.user_type,
      profileId: query.profile_id,
      status: query.status,
      search: query.search,
      createdBy: query.created_by,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      limit: query.limit,
    });
  }

  @Get('counts')
  @Roles('admin', 'operator')
  counts() {
    return this.service.voucherCounts();
  }

  @Post('generate')
  @Roles('admin')
  generate(@Req() request: Request, @Body() dto: GenerateVoucherDto) {
    return this.service.generateVouchers(actorOf(request), dto);
  }

  @Post(':id/activate')
  @Roles('admin', 'operator')
  activate(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.activateVoucher(actorOf(request), id);
  }

  @Patch(':id/status')
  @Roles('admin')
  setStatus(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVoucherStatusDto,
  ) {
    return this.service.setVoucherStatus(actorOf(request), id, dto.status);
  }

  @Post('expire-overdue')
  @Roles('admin')
  expireOverdue() {
    return this.service.expireOverdue();
  }

  @Post('remove')
  @Roles('admin')
  remove(@Req() request: Request, @Body() dto: RemoveVouchersDto) {
    return this.service.removeVouchers(actorOf(request), dto.ids);
  }
}

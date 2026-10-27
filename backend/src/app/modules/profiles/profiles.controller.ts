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
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateBandwidthDto,
  CreateGroupProfileDto,
  CreateServiceProfileDto,
  GenerateVoucherDto,
  ListVoucherQueryDto,
  RemoveVouchersDto,
  BulkVoucherStatusDto,
  SendVoucherWhatsAppDto,
  UpdateBandwidthDto,
  UpdateGroupProfileDto,
  UpdateServiceProfileDto,
  UpdateVoucherStatusDto,
} from './dto/profiles.dto';
import { ProfilesService } from './profiles.service';

/** "1,2,3" → [1,2,3]; kosong/aneh → undefined (berarti seluruh hasil filter). */
function parseIds(raw?: string): number[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return ids.length > 0 ? ids : undefined;
}

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
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
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
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UsePipes(validation)
export class VouchersController {
  constructor(private readonly service: ProfilesService) {}

  @Get()
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.view')
  list(@Req() request: Request, @Query() query: ListVoucherQueryDto) {
    return this.service.listVouchers(actorOf(request), {
      profileType: query.profile_type,
      userType: query.user_type,
      profileId: query.profile_id,
      status: query.status,
      search: query.search,
      createdBy: query.created_by,
      ownerId: query.owner_id,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      limit: query.limit,
    });
  }

  /**
   * Ekspor voucher terpilih (atau seluruh hasil filter bila `ids` kosong).
   * CSV untuk dibuka di spreadsheet, PDF untuk dicetak/dikirim.
   */
  @Get('export.csv')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.print')
  async exportCsv(@Req() request: Request, @Res() response: Response, @Query('ids') ids?: string) {
    const rows = await this.service.voucherRowsForExport(actorOf(request), parseIds(ids));
    const header = [
      'username', 'password', 'profile_type', 'profile', 'user_type', 'status',
      'price', 'tax', 'owner', 'created_by', 'created_at',
    ];
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((row) =>
      [
        row.username, row.password, row.profile_type, row.profile_name, row.user_type, row.status,
        row.price, row.tax_amount, row.owner_name ?? '', row.created_by_name ?? '', row.created_at ?? '',
      ].map(escape).join(','),
    );
    const csv = [header.join(','), ...body].join('\r\n');
    response
      .status(200)
      .setHeader('content-type', 'text/csv; charset=utf-8')
      .setHeader('content-disposition', `attachment; filename="voucher-${Date.now()}.csv"`)
      .send(`\uFEFF${csv}`);
  }

  @Get('export.pdf')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.print')
  async exportPdf(@Req() request: Request, @Res() response: Response, @Query('ids') ids?: string) {
    const rows = await this.service.voucherRowsForExport(actorOf(request), parseIds(ids));
    const pdf = this.service.buildVoucherPdf(ProfilesService.toCards(rows));
    response
      .status(200)
      .setHeader('content-type', 'application/pdf')
      .setHeader('content-disposition', `attachment; filename="voucher-${Date.now()}.pdf"`)
      .send(pdf);
  }

  @Get('counts')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.view')
  counts(@Req() request: Request) {
    return this.service.voucherCounts(actorOf(request));
  }

  @Post('generate')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.generate')
  generate(@Req() request: Request, @Body() dto: GenerateVoucherDto) {
    return this.service.generateVouchers(actorOf(request), dto);
  }

  @Post(':id/activate')
  @Roles('admin', 'operator')
  activate(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.activateVoucher(actorOf(request), id);
  }

  // Didaftarkan sebelum ':id/status' supaya "bulk" tidak dianggap id.
  @Patch('bulk/status')
  @Roles('admin', 'operator')
  @RequirePermission('voucher.generate')
  bulkStatus(@Req() request: Request, @Body() dto: BulkVoucherStatusDto) {
    return this.service.bulkVoucherStatus(actorOf(request), dto.ids, dto.status);
  }

  @Post('send-whatsapp')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.print')
  sendWhatsApp(@Req() request: Request, @Body() dto: SendVoucherWhatsAppDto) {
    return this.service.sendVouchersWhatsApp(actorOf(request), dto.ids, dto.phone);
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

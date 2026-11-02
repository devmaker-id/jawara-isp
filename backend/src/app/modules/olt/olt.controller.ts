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
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';
import { AssignOnuDto, CreateOltDeviceDto, ReleaseOnuDto, UpdateOltDeviceDto } from './dto/olt.dto';
import { OltService } from './olt.service';

type Actor = { userId: number; ip: string };

const actorOf = (request: Request): Actor => {
  const user = (request as Request & { user?: { sub?: number } }).user;
  return { userId: Number(user?.sub ?? 0), ip: request.ip ?? '' };
};

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

/**
 * Endpoint manajemen OLT.
 *
 * Semua endpoint di sini READ-ONLY terhadap perangkat: yang ditulis hanya
 * database panel (data perangkat + inventori hasil pembacaan). Tidak ada
 * endpoint yang mengubah konfigurasi OLT.
 */
@Controller('olt')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UsePipes(validation)
export class OltController {
  constructor(private readonly service: OltService) {}

  // ===== perangkat =====
  @Get('devices')
  @Roles('admin', 'operator')
  @RequirePermission('olt.view')
  devices() {
    return this.service.listDevices();
  }

  @Post('devices')
  @Roles('admin', 'operator')
  @RequirePermission('olt.create')
  create(@Req() request: Request, @Body() dto: CreateOltDeviceDto) {
    return this.service.createDevice(dto, actorOf(request));
  }

  @Patch('devices/:id')
  @Roles('admin', 'operator')
  @RequirePermission('olt.update')
  update(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOltDeviceDto,
  ) {
    return this.service.updateDevice(id, dto, actorOf(request));
  }

  @Delete('devices/:id')
  @Roles('admin')
  @RequirePermission('olt.delete')
  remove(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeDevice(id, actorOf(request));
  }

  // ===== membaca perangkat =====
  @Post('devices/:id/test')
  @Roles('admin', 'operator')
  @RequirePermission('olt.sync')
  test(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.testDevice(id, actorOf(request));
  }

  @Post('devices/:id/sync')
  @Roles('admin', 'operator')
  @RequirePermission('olt.sync')
  sync(@Req() request: Request, @Param('id', ParseIntPipe) id: number) {
    return this.service.syncDevice(id, actorOf(request));
  }

  @Get('devices/:id/runs')
  @Roles('admin', 'operator')
  @RequirePermission('olt.view')
  runs(@Param('id', ParseIntPipe) id: number) {
    return this.service.listRuns(id);
  }

  // ===== inventori =====
  @Get('onus')
  @Roles('admin', 'operator')
  @RequirePermission('olt.view')
  onus(
    @Query('olt_id') oltId?: string,
    @Query('online') online?: string,
    @Query('search') search?: string,
    @Query('max_rx') maxRx?: string,
    @Query('assigned') assigned?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.service.listOnus({
      oltId: oltId ? Number(oltId) : undefined,
      online: online === undefined || online === '' ? undefined : online === 'true' || online === '1',
      search: search?.trim() || undefined,
      maxRx: maxRx ? Number(maxRx) : undefined,
      assigned: assigned === 'true' || assigned === '1' ? 'assigned'
        : assigned === 'false' || assigned === '0' ? 'unassigned'
        : undefined,
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
  }

  // ===== pemasangan ONU ke pelanggan =====
  @Get('onus/:id/history')
  @Roles('admin', 'operator')
  @RequirePermission('olt.view')
  onuHistory(@Param('id', ParseIntPipe) id: number) {
    return this.service.onuHistory(id);
  }

  @Post('onus/:id/assign')
  @Roles('admin', 'operator')
  @RequirePermission('olt.update')
  assignOnu(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOnuDto,
  ) {
    if (dto.customer_id === undefined && !dto.internet_no) {
      throw new BadRequestException('Isi Nomor Internet pelanggan atau pilih pelanggan terlebih dahulu.');
    }
    return this.service.assignOnu(id, dto, actorOf(request));
  }

  @Post('onus/:id/release')
  @Roles('admin', 'operator')
  @RequirePermission('olt.update')
  releaseOnu(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReleaseOnuDto,
  ) {
    return this.service.releaseOnu(id, dto.note, actorOf(request));
  }

  // ONU milik satu pelanggan — dipakai halaman detail pelanggan.
  @Get('customers/:customerId/onu')
  @Roles('admin', 'operator')
  @RequirePermission('olt.view')
  customerOnu(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.service.customerOnu(customerId);
  }
}
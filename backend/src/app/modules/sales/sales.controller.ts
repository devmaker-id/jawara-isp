import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { RequestScope, Scope } from '../auth/request-scope';
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';
import { CreateVoucherSaleDto, VoidSaleDto } from './dto/sale.dto';
import { SaleActor, SalesService } from './sales.service';

const actorOf = (request: Request): SaleActor => {
  const user = (request as Request & { user?: { sub?: number; role?: string } }).user;
  return {
    userId: Number(user?.sub ?? 0),
    role: user?.role,
    ip: request.ip ?? '',
  };
};

/**
 * Penjualan voucher & rekap pendapatan.
 *
 * `scope` selalu berasal dari token (bukan query/body), sehingga tidak ada
 * jalan bagi reseller untuk melihat angka pemilik lain.
 */
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // ===== pendapatan =====
  @Get('revenue')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('report.view')
  revenue(
    @Scope() scope: RequestScope,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.sales.revenue(from, to, scope);
  }

  // ===== penjualan voucher =====
  @Get('vouchers')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.view')
  list(
    @Scope() scope: RequestScope,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('profile_type') profileType?: string,
    @Query('owner_id') ownerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sales.listSales(
      {
        from,
        to,
        profile_type: profileType === 'hotspot' || profileType === 'ppp' ? profileType : undefined,
        owner_id: ownerId ? Number(ownerId) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      },
      scope,
    );
  }

  @Post('vouchers')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.sell')
  create(@Req() request: Request, @Body() dto: CreateVoucherSaleDto) {
    return this.sales.createSale(dto, actorOf(request));
  }

  @Post('vouchers/:id/void')
  @Roles('admin', 'operator')
  @RequirePermission('voucher.void')
  void(
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidSaleDto,
  ) {
    return this.sales.voidSale(id, dto, actorOf(request));
  }

  /** Voucher yang belum pernah dicatat terjual — untuk pilihan di form. */
  @Get('unsold-vouchers')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('voucher.view')
  unsold(@Scope() scope: RequestScope, @Query('limit') limit?: string) {
    const ownerId = scope.role === 'admin' ? undefined : (scope.userId ?? undefined);
    return this.sales.unsoldVouchers(ownerId, limit ? Number(limit) : 100);
  }
}

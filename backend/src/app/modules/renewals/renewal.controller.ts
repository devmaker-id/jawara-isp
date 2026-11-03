import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequestScope, Scope } from '../auth/request-scope';
import { RequirePermission } from '../permissions/permission.guard';
import { RenewCustomerDto, RenewalPreviewQueryDto } from './dto/renewal.dto';
import { RenewalService } from './renewal.service';

// Pelaku dari token, tidak pernah dari body: id/nama/email/IP.
function actorOf(req: AuthenticatedRequest) {
  const account = req.account;
  if (!account) throw new UnauthorizedException('Pelaku perpanjangan tidak teridentifikasi');
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    ip: req.ip ?? req.socket?.remoteAddress ?? 'tidak-diketahui',
  };
}

const renewalValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

/**
 * Perpanjangan layanan pelanggan (Hotspot & PPPoE).
 *
 * Path mengikuti modul pelanggan (`/customers/:id/...`) karena yang dikelola
 * adalah layanan milik pelanggan yang sudah ada — tidak ada entitas baru.
 */
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(renewalValidation)
export class RenewalController {
  constructor(private readonly renewals: RenewalService) {}

  @Get(':id/renewal-preview')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.update')
  preview(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RenewalPreviewQueryDto,
    @Scope() scope: RequestScope,
  ) {
    return this.renewals.preview(id, query, scope);
  }

  @Post(':id/renew')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.update')
  renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewCustomerDto,
    @Scope() scope: RequestScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.renewals.renew(id, dto, scope, actorOf(req));
  }

  @Get(':id/renewals')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.view')
  history(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.renewals.history(id, scope);
  }
}
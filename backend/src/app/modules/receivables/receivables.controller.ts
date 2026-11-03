import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { ReceivableQueryDto, SetCreditLimitDto } from './dto/receivable.dto';
import { ReceivablesService } from './receivables.service';

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function actorOf(req: AuthenticatedRequest) {
  const account = req.account;
  if (!account) throw new UnauthorizedException('Pelaku tidak teridentifikasi');
  return { id: account.id, ip: req.ip ?? req.socket?.remoteAddress ?? 'tidak-diketahui' };
}

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(validation)
export class CustomerReceivableController {
  constructor(private readonly receivables: ReceivablesService) {}

  /** Saldo piutang + daftar tagihan belum lunas milik satu pelanggan. */
  @Get(':id/receivable')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('invoice.view')
  balance(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.receivables.balance(id, scope);
  }

  /** Batas piutang per pelanggan — hanya admin. */
  @Patch(':id/credit-limit')
  @Roles('admin')
  @RequirePermission('customer.update')
  setLimit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCreditLimitDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.receivables.setLimit(id, dto, actorOf(req));
  }
}

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(validation)
export class ReceivableReportController {
  constructor(private readonly receivables: ReceivablesService) {}

  /** Laporan piutang + aging; cakupan reseller diterapkan di SQL. */
  @Get('receivables')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('invoice.view')
  report(@Query() query: ReceivableQueryDto, @Scope() scope: RequestScope) {
    return this.receivables.report(query, scope);
  }

  @Get('receivables/summary')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('invoice.view')
  summary(@Scope() scope: RequestScope) {
    return this.receivables.summary(scope);
  }
}
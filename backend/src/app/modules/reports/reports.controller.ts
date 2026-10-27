import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequestScope, Scope } from '../auth/request-scope';
import { ReportQueryDto } from './dto/report.dto';
import { ReportsService } from './reports.service';
import { ContributionsService } from './contributions.service';

// Laporan keuangan. Reseller hanya menerima angka miliknya sendiri: cakupan
// diambil dari akun terautentikasi dan diterapkan di SQL (termasuk pemasukan,
// saldo, metode, daftar baris, dan total), bukan filter di memori.
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly contributions: ContributionsService,
  ) {}

  @Get()
  @Roles('admin', 'operator', 'resseler')
  report(@Query() query: ReportQueryDto, @Scope() scope: RequestScope) {
    return this.reportsService.build(query, scope);
  }

  /**
   * Kontribusi per akun: berapa pelanggan/voucher/profil yang DIBUAT siapa.
   * Reseller hanya menerima barisnya sendiri (dipaksa di server).
   */
  @Get('contributions')
  @Roles('admin', 'operator', 'resseler')
  contributionsSummary(
    @Query() query: { from?: string; to?: string },
    @Scope() scope: RequestScope,
  ) {
    const valid = (value?: string) =>
      value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    return this.contributions.summary(valid(query.from), valid(query.to), scope);
  }
}

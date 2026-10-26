import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequestScope, Scope } from '../auth/request-scope';
import { ReportQueryDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

// Laporan keuangan. Reseller hanya menerima angka miliknya sendiri: cakupan
// diambil dari akun terautentikasi dan diterapkan di SQL (termasuk pemasukan,
// saldo, metode, daftar baris, dan total), bukan filter di memori.
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @Roles('admin', 'operator', 'resseler')
  report(@Query() query: ReportQueryDto, @Scope() scope: RequestScope) {
    return this.reportsService.build(query, scope);
  }
}

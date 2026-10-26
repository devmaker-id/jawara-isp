import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequestScope, Scope } from '../auth/request-scope';
import { ExportsService } from './exports.service';

// Ekspor CSV dijalankan di server (bukan menyusun CSV di browser) supaya
// cakupan data dapat ditegakkan di tempat yang sama dengan daftar/laporan.
// Reseller hanya menerima baris milik pelanggannya; mutasi tetap admin/operator.
@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get(':type')
  @Roles('admin', 'operator', 'resseler')
  async download(
    @Param('type') type: string,
    @Scope() scope: RequestScope,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const kind = this.exportsService.assertType(type);
    const result = await this.exportsService.build(kind, scope);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    // Jumlah baris dilaporkan eksplisit; pemotongan tidak boleh disembunyikan.
    res.setHeader('X-Export-Rows', String(result.rows));
    res.setHeader('X-Export-Row-Limit', String(this.exportsService.rowLimit));

    return result.csv;
  }
}
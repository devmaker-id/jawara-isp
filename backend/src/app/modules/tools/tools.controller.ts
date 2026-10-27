import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';
import { ImportDatabaseDto } from './dto/tools.dto';
import { ToolsService } from './tools.service';

// Impor/ekspor hanya untuk admin: keduanya menyentuh seluruh isi database,
// bukan data milik satu reseller.
@Controller('tools')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Roles('admin')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get('tables')
  tables() {
    return this.tools.listTables();
  }

  // `download=0` mengembalikan teks di JSON agar bisa dipratinjau di panel.
  @Get('export/:table')
  @RequirePermission('tools.export')
  async export(
    @Param('table') table: string,
    @Query('format') format: string,
    @Query('download') download: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const kind = format === 'sql' ? 'sql' : 'csv';
    const file =
      kind === 'sql' ? await this.tools.exportSql(table) : await this.tools.exportCsv(table);

    if (download === '0') {
      return { filename: file.filename, format: kind, content: file.content };
    }

    res.setHeader('Content-Type', kind === 'sql' ? 'application/sql' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.content;
  }

  @Post('import')
  @RequirePermission('tools.import')
  async import(@Body() dto: ImportDatabaseDto) {
    if (dto.format === 'csv' && !dto.table) {
      throw new BadRequestException('Impor CSV wajib menyebutkan tabel tujuan.');
    }
    return this.tools.import(
      dto.table ?? '-',
      dto.format,
      dto.content,
      dto.mode === 'replace' ? 'replace' : 'append',
    );
  }
}

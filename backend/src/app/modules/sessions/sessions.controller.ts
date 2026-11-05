import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequestScope, Scope } from '../auth/request-scope';
import { SessionQueryDto } from './dto/session.dto';
import { SessionsService } from './sessions.service';

/**
 * Sesi online dari accounting RADIUS (semua NAS), plus tombol putus sesi.
 *
 * Cakupan diambil dari akun terautentikasi dan diterapkan di SQL: admin &
 * operator melihat semua sesi, reseller hanya sesi milik datanya. Memutus sesi
 * dibatasi admin & operator — tindakan ini memutus pelanggan yang sedang online.
 */
@Controller('sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @Roles('admin', 'operator', 'resseler')
  list(@Query() query: SessionQueryDto, @Scope() scope: RequestScope) {
    return this.sessions.list(
      {
        jenis: query.jenis,
        userType: query.user_type,
        search: query.search,
        page: query.page,
        limit: query.limit,
      },
      scope,
    );
  }

  @Get(':id')
  @Roles('admin', 'operator', 'resseler')
  detail(@Param('id') id: string, @Scope() scope: RequestScope) {
    return this.sessions.detail(id, scope);
  }

  @Post(':id/disconnect')
  @Roles('admin', 'operator')
  disconnect(@Param('id') id: string, @Scope() scope: RequestScope) {
    return this.sessions.disconnect(id, scope);
  }

  // Putus semua sesi aktif milik satu username (tendang saat hapus akun).
  @Post('by-username/:username/disconnect')
  @Roles('admin', 'operator')
  disconnectByUsername(@Param('username') username: string) {
    return this.sessions.disconnectByUsername(decodeURIComponent(username));
  }
}

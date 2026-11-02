import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { WaGatewayService } from './wa-gateway.service';
import { WaRouterService } from './wa-router.service';

/**
 * Endpoint WhatsApp Gateway.
 *
 * Semua endpoint di sini ADMIN saja: QR pairing dan daftar nomor adalah
 * kredensial/kebijakan, bukan data operasional biasa. Tidak ada endpoint
 * publik untuk QR.
 */
@Controller('whatsapp-gateway')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class WaGatewayController {
  constructor(
    private readonly gateway: WaGatewayService,
    private readonly router: WaRouterService,
  ) {}

  @Get('status')
  status() {
    return this.gateway.status();
  }

  @Get('qr')
  qr() {
    return this.gateway.qr();
  }

  @Post('connect')
  connect() {
    return this.gateway.connect();
  }

  @Post('logout')
  logout() {
    return this.gateway.logout();
  }

  @Get('settings')
  settings() {
    return this.gateway.settings();
  }

  @Put('settings')
  saveSettings(@Body() body: { values?: Record<string, string> }) {
    return this.gateway.saveSettings(body?.values ?? {});
  }

  @Get('allowlist')
  allowlist() {
    return this.gateway.allowlist();
  }

  @Post('allowlist')
  addAllowlist(
    @Body() body: { kind: 'number' | 'group'; value: string; label?: string; is_admin?: boolean },
  ) {
    return this.gateway.addAllowlist(body);
  }

  @Patch('allowlist/:id')
  toggle(@Param('id', ParseIntPipe) id: number, @Body() body: { is_active: boolean }) {
    return this.gateway.toggleAllowlist(id, Boolean(body?.is_active));
  }

  @Delete('allowlist/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.gateway.removeAllowlist(id);
  }

  @Get('commands')
  commands() {
    return { rows: this.router.list() };
  }

  @Get('messages')
  messages(@Query('limit') limit?: string) {
    return this.gateway.messages(limit ? Number(limit) : 50);
  }

  @Get('monitor')
  monitor() {
    return this.gateway.monitor();
  }
}

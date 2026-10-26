import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

// Operator boleh membaca (mis. untuk melihat metode pembayaran yang aktif),
// tetapi hanya admin yang boleh mengubah konfigurasi/integrasi.
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles('admin', 'operator')
  get() {
    return this.settingsService.get();
  }

  @Put()
  @Roles('admin')
  update(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.update(dto.values);
  }
}

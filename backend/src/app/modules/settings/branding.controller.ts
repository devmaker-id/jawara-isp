import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Identitas panel tanpa autentikasi.
 *
 * Halaman login harus bisa menampilkan nama dan logo sebelum ada token, dan
 * reseller tidak punya izin membaca /settings. Endpoint ini hanya mengembalikan
 * lima nilai `brand_*` — tidak ada kredensial, tidak ada konfigurasi integrasi.
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.branding();
  }
}

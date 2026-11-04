import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { ConfigService } from './app/config/config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Foto profil disajikan di /api/uploads supaya ikut jalur proxy frontend
  // (vite hanya meneruskan /api) dan tidak perlu aturan tambahan.
  // Disajikan dari backend/uploads (bukan dist/): `nest build` memakai
  // deleteOutDir dan menghapus dist, jadi berkas unggahan tidak boleh ada di sana.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/api/uploads/',
    maxAge: '7d',
  });
  // Impor database mengirim isi file sebagai teks di body JSON; batas bawaan
  // Express (100kb) terlalu kecil untuk dump .sql satu tabel.
  app.use(json({ limit: '32mb' }));
  app.use(urlencoded({ extended: true, limit: '32mb' }));
  // ConfigService bergantung pada DatabaseService (DI), jadi diambil dari
  // container alih-alih di-`new` manual.
  const configService = app.get(ConfigService);
  // Gagal cepat bila JWT_SECRET / SECRET_KEY kosong: lebih baik boot berhenti
  // daripada melayani token yang ditandatangani dengan nilai default.
  configService.assertRequiredSecrets();
  app.setGlobalPrefix('api');
  await app.listen(configService.app.port, '0.0.0.0');
  console.log(`Server running on port ${configService.app.port}`);
}
bootstrap();

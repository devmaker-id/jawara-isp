import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './app/config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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

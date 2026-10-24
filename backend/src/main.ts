import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './app/config/config.service';

async function bootstrap() {
  const configService = new ConfigService();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  await app.listen(configService.app.port, '0.0.0.0');
  console.log(`Server running on port ${configService.app.port}`);
}
bootstrap();

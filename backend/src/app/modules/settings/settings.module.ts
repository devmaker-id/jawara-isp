import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthModule, JwtModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService],
})
export class SettingsModule {}

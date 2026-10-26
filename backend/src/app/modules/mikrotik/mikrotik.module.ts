import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '../../config/config.service';
import { MikrotikController } from './mikrotik.controller';
import { MikrotikDevicesRepository } from './mikrotik-devices.repository';
import { MikrotikService } from './mikrotik.service';

@Module({
  imports: [AuthModule],
  controllers: [MikrotikController],
  providers: [MikrotikService, MikrotikDevicesRepository, ConfigService],
  exports: [MikrotikService],
})
export class MikrotikModule {}

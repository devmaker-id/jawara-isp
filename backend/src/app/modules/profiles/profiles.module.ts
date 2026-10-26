import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MikrotikModule } from '../mikrotik/mikrotik.module';
import { ConfigService } from '../../config/config.service';
import { ProfilesController, VouchersController } from './profiles.controller';
import {
  BandwidthRepository,
  GroupProfileRepository,
  ServiceProfileRepository,
  VoucherRepository,
} from './profiles.repository';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule, MikrotikModule],
  controllers: [ProfilesController, VouchersController],
  providers: [
    ProfilesService,
    BandwidthRepository,
    GroupProfileRepository,
    ServiceProfileRepository,
    VoucherRepository,
    ConfigService,
  ],
  exports: [ProfilesService],
})
export class ProfilesModule {}

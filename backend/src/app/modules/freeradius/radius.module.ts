import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MikrotikModule } from '../mikrotik/mikrotik.module';
import { ConfigService } from '../../config/config.service';
import { RadiusController } from './radius.controller';
import { RadiusInstallService } from './radius-install.service';
import { RadiusConfigService } from './radius-config.service';
import { RadiusEnforcementService } from './radius-enforcement.service';
import { RadiusRepository } from './radius.repository';
import { RadiusService } from './radius.service';

@Module({
  imports: [AuthModule, MikrotikModule],
  controllers: [RadiusController],
  providers: [
    RadiusService,
    RadiusRepository,
    RadiusInstallService,
    RadiusConfigService,
    RadiusEnforcementService,
    ConfigService,
  ],
  exports: [RadiusService, RadiusEnforcementService],
})
export class RadiusModule {}
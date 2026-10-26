import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MikrotikModule } from '../mikrotik/mikrotik.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, DatabaseModule, MikrotikModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

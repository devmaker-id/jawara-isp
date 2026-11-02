import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { SalesModule } from '../sales/sales.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, DatabaseModule, SalesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ContributionsService } from './contributions.service';

@Module({
  imports: [AuthModule, JwtModule, PaymentsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ContributionsService],
})
export class ReportsModule {}

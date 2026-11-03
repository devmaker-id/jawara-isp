import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesModule } from '../sales/sales.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ContributionsService } from './contributions.service';
import { VoucherUsageService } from './voucher-usage.service';

@Module({
  imports: [InvoicesModule, AuthModule, JwtModule, PaymentsModule, SalesModule],
  controllers: [ReportsController],
  providers: [ReportsService, ContributionsService, VoucherUsageService],
})
export class ReportsModule {}

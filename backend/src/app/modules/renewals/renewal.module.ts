import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { RenewalController } from './renewal.controller';
import { RenewalRepository } from './renewal.repository';
import { RenewalService } from './renewal.service';

@Module({
  imports: [AuthModule, JwtModule, InvoicesModule, PaymentsModule],
  controllers: [RenewalController],
  providers: [RenewalService, RenewalRepository],
  exports: [RenewalService],
})
export class RenewalModule {}
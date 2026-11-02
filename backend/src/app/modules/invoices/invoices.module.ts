import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { JwtModule } from '@nestjs/jwt';
import { FinanceEventsRepository } from '../finance/finance-events.repository';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesRepository } from './invoices.repository';

@Module({
  imports: [AuthModule, JwtModule, PaymentsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesRepository, FinanceEventsRepository],
  exports: [InvoicesService],
})
export class InvoicesModule {}

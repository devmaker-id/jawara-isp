import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';

// Penagihan otomatis: pembuatan tagihan bulanan + pengakuan pendapatan postpaid.
// DatabaseService tersedia global (DatabaseModule), jadi tidak perlu diimpor ulang.
@Module({
  providers: [BillingService],
})
export class BillingModule {}
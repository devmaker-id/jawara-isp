import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { VoucherSalesRepository } from './voucher-sales.repository';

/**
 * Penjualan voucher & rekap pendapatan.
 *
 * Diekspor karena Dashboard memakai `revenueSnapshot()` — satu perhitungan
 * dipakai dua tempat, supaya angka dashboard dan laporan tidak bisa berbeda.
 */
@Module({
  imports: [AuthModule],
  controllers: [SalesController],
  providers: [SalesService, VoucherSalesRepository],
  exports: [SalesService],
})
export class SalesModule {}

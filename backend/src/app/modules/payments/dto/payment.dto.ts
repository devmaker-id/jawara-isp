import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  QRIS = 'qris',
  OTHER = 'other',
}

// payments.amount DECIMAL(12,2) → maksimum 10 digit sebelum koma.
export const MAX_PAYMENT_AMOUNT = 9_999_999_999.99;

// DATE di MySQL tidak menyimpan jam; tolak datetime agar tidak terpotong diam-diam.
export const PAYMENT_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'tanggal harus format YYYY-MM-DD';

export class CreatePaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount maksimal 2 angka desimal' })
  @Min(0.01, { message: 'amount minimal 0.01' })
  @Max(MAX_PAYMENT_AMOUNT, { message: 'amount melebihi kapasitas kolom DECIMAL(12,2)' })
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'method harus cash, transfer, qris, atau other' })
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'reference maksimal 64 karakter' })
  reference?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(PAYMENT_DATE_ONLY, { message: DATE_MESSAGE })
  paid_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'note maksimal 255 karakter' })
  note?: string;

  // Kunci idempoten per dialog pembayaran: kirim ulang kunci yang sama tidak
  // menagih dua kali. Satu kunci yang barisnya sudah di-void → 409.
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'idempotency_key minimal 8 karakter' })
  @MaxLength(64, { message: 'idempotency_key maksimal 64 karakter' })
  idempotency_key?: string;
}

export class VoidPaymentDto {
  @IsString({ message: 'reason wajib berupa teks' })
  @MinLength(1, { message: 'reason wajib diisi' })
  @MaxLength(255, { message: 'reason maksimal 255 karakter' })
  reason: string;
}

// Pembayaran dibuat dari halaman Pembayaran: invoice dipilih di body, sisanya
// identik dengan POST /invoices/:id/payments (satu jalur ledger).
export class CreatePaymentBodyDto extends CreatePaymentDto {
  @IsInt({ message: 'invoice_id harus bilangan bulat' })
  @Min(1, { message: 'invoice_id tidak valid' })
  invoice_id: number;
}

export class ListPaymentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'search maksimal 100 karakter' })
  search?: string;

  @IsOptional()
  @Matches(PAYMENT_DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(PAYMENT_DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'method tidak dikenal' })
  method?: PaymentMethod;

  @IsOptional()
  @IsIn(['valid', 'void', 'all'], { message: 'status harus valid, void, atau all' })
  status?: 'valid' | 'void' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200, { message: 'limit maksimal 200' })
  limit?: number;
}

export class PayableInvoicesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50, { message: 'limit maksimal 50' })
  limit?: number;
}

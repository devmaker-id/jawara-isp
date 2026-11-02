import { Transform, Type } from 'class-transformer';
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

export enum InvoiceStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
  OVERDUE = 'overdue',
  // Ditambahkan setelah migrasi 001 (enum DB: partial di posisi terakhir).
  // Hanya ditulis oleh alur pembayaran, bukan lewat PATCH tagihan.
  PARTIAL = 'partial',
  // Ditambahkan migrasi 032. Hanya ditulis oleh endpoint void.
  VOID = 'void',
}

// Kolom amount DECIMAL(12,2) → maksimum 10 digit sebelum koma.
export const MAX_INVOICE_AMOUNT = 9_999_999_999.99;

// DATE di MySQL tidak menyimpan jam; tolak datetime agar tidak terpotong diam-diam.
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'tanggal harus format YYYY-MM-DD';

export class CreateInvoiceDto {
  @IsInt({ message: 'customer_id harus bilangan bulat' })
  @Min(1, { message: 'customer_id tidak valid' })
  customer_id: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount maksimal 2 angka desimal' })
  @Min(0.01, { message: 'amount minimal 0.01' })
  @Max(MAX_INVOICE_AMOUNT, { message: 'amount melebihi kapasitas kolom DECIMAL(12,2)' })
  amount: number;

  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  due_date: string;

  // Periode penagihan (migrasi 032). Harus diisi berpasangan; NULL keduanya
  // untuk tagihan yang memang tidak punya periode (mis. tagihan non-layanan).
  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  period_start?: string | null;

  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  period_end?: string | null;

  // Akun RADIUS yang ditagih. Opsional: tagihan non-layanan tetap boleh ada,
  // tetapi tanpa username pembayaran tidak bisa mengaktifkan akun.
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'username maksimal 64 karakter' })
  username?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'description maksimal 255 karakter' })
  description?: string;

  // "paid" hanya lewat /invoices/:id/pay agar paid_date selalu terisi.
  @IsOptional()
  @IsEnum(InvoiceStatus, { message: 'status awal harus unpaid atau overdue' })
  status?: InvoiceStatus;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsInt({ message: 'customer_id harus bilangan bulat' })
  @Min(1, { message: 'customer_id tidak valid' })
  customer_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount maksimal 2 angka desimal' })
  @Min(0.01, { message: 'amount minimal 0.01' })
  @Max(MAX_INVOICE_AMOUNT, { message: 'amount melebihi kapasitas kolom DECIMAL(12,2)' })
  amount?: number;

  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  due_date?: string;

  // Kirim `null` untuk mengosongkan periode; kirim keduanya sekaligus.
  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  period_start?: string | null;

  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  period_end?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'username maksimal 64 karakter' })
  username?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'description maksimal 255 karakter' })
  description?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}

export class PayInvoiceDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount maksimal 2 angka desimal' })
  @Min(0.01, { message: 'amount minimal 0.01' })
  @Max(MAX_INVOICE_AMOUNT, { message: 'amount melebihi kapasitas kolom DECIMAL(12,2)' })
  amount: number;

  @IsOptional()
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  paid_date?: string;
}

// Alasan wajib: pembatalan tanpa alasan tidak bisa diaudit.
export class VoidInvoiceDto {
  @IsString({ message: 'alasan void wajib diisi' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(5, { message: 'alasan void minimal 5 karakter' })
  @MaxLength(255, { message: 'alasan void maksimal 255 karakter' })
  reason: string;
}
// Query daftar tagihan (Fase 0: pagination & pencarian di server).
export class ListInvoicesQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsIn(['unpaid', 'paid', 'overdue', 'partial', 'void'])
  @IsOptional()
  status?: 'unpaid' | 'paid' | 'overdue' | 'partial' | 'void';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Batas mengikuti pilihan "tampilkan" di panel: 25/50/100/500/1000.
  @Max(1000)
  @IsOptional()
  limit?: number;
}

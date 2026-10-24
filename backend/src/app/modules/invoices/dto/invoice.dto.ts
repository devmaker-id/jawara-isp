import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum InvoiceStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
  OVERDUE = 'overdue',
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
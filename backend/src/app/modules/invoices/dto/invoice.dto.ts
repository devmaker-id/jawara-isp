import { IsString, IsNumber, IsEnum, IsDateString, IsOptional } from 'class-validator';

export enum InvoiceStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
  OVERDUE = 'overdue',
}

export class CreateInvoiceDto {
  @IsNumber()
  customer_id: number;

  @IsNumber()
  amount: number;

  @IsDateString()
  due_date: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;
}

export class UpdateInvoiceDto {
  @IsNumber()
  @IsOptional()
  customer_id?: number;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;
}

export class PayInvoiceDto {
  @IsNumber()
  amount: number;
}

import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PaymentMethod } from '../../payments/dto/payment.dto';

export const REPORT_TYPES = ['summary', 'transactions', 'unpaid', 'by-method'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'tanggal harus format YYYY-MM-DD';

export class ReportQueryDto {
  @IsIn(REPORT_TYPES as unknown as string[], {
    message: 'type harus summary, transactions, unpaid, atau by-method',
  })
  type: ReportType;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'method tidak dikenal' })
  method?: PaymentMethod;

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

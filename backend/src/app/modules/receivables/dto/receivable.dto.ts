import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 999_999_999.99;

export class SetCreditLimitDto {
  // 0 = piutang tidak diizinkan (bukan tak terbatas).
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'limit maksimal 2 angka desimal' })
  @Min(0, { message: 'limit tidak boleh negatif' })
  @Max(MAX_LIMIT, { message: 'limit melebihi kapasitas kolom DECIMAL(12,2)' })
  limit!: number;
}

export class ReceivableQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from harus format YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to harus format YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'due_from harus format YYYY-MM-DD' })
  due_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'due_to harus format YYYY-MM-DD' })
  due_to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id?: number;

  @IsOptional()
  @IsIn(['hotspot', 'ppp'], { message: 'profile_type harus hotspot atau ppp' })
  profile_type?: 'hotspot' | 'ppp';

  @IsOptional()
  @IsIn(['unpaid', 'partial'], { message: 'status harus unpaid atau partial' })
  status?: 'unpaid' | 'partial';

  /** Posisi laporan per tanggal (YYYY-MM-DD). Kosong = hari ini. */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'as_of harus format YYYY-MM-DD' })
  as_of?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
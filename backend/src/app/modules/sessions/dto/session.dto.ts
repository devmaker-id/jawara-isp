import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { SessionKind } from '../sessions.repository';

export class SessionQueryDto {
  @IsOptional()
  @IsIn(['hotspot', 'ppp'], { message: 'jenis harus hotspot atau ppp' })
  jenis?: SessionKind;

  @IsOptional()
  @IsIn(['voucher', 'member'], { message: 'user_type harus voucher atau member' })
  user_type?: 'voucher' | 'member';

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'pencarian maksimal 64 karakter' })
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
  @Max(1000, { message: 'limit maksimal 1000' })
  limit?: number;
}

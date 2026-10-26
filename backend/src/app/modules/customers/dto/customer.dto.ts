import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateCustomerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

// Query daftar pelanggan (Fase 0: pagination & pencarian di server).
export class ListCustomersQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}

// Penetapan pemilik. `reseller_id: null` berarti melepas penugasan.
export class AssignOwnerDto {
  @ValidateIf((o: AssignOwnerDto) => o.reseller_id !== null)
  @Type(() => Number)
  @IsInt({ message: 'reseller_id harus berupa angka atau null' })
  @Min(1, { message: 'reseller_id tidak valid' })
  reseller_id!: number | null;
}

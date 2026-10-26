import {
  IsString,
  IsEmail,
  IsEnum,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '../../../config/config.service';

// Panjang minimum untuk akun baru. Password lama (di luar alur ini) tidak
// terpengaruh karena hanya divalidasi saat dibuat/diubah lewat endpoint ini.
const MIN_PASSWORD_LENGTH = 8;

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: `password minimal ${MIN_PASSWORD_LENGTH} karakter` })
  password: string;

  @IsEnum(Role)
  role: Role;

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

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MinLength(MIN_PASSWORD_LENGTH, { message: `password minimal ${MIN_PASSWORD_LENGTH} karakter` })
  password?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

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

// Query daftar pengguna. `status` sengaja berupa kata (active/inactive) agar
// frontend tidak perlu mengirim boolean dalam query string.
export class ListUsersQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

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

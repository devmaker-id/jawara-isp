import { IsString, IsEmail, IsEnum, IsBoolean, IsOptional, MinLength } from 'class-validator';
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

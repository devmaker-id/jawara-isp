import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Validasi data perangkat OLT.
 *
 * Aturan sama seperti perangkat MikroTik: password hanya wajib saat membuat,
 * dan saat mengubah boleh dikosongkan yang berarti "jangan ubah". Password
 * tidak pernah dikirim balik oleh API.
 */

const boolFromInput = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'ya'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'tidak'].includes(text)) return false;
  return undefined;
};

const NAME_RULE = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{1,62}[A-Za-z0-9]$/;
const HOST_RULE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
/** Port PON: "0/1" atau daftar "0/1,0/2". */
const PON_RULE = /^\d{1,2}\/\d{1,2}(,\s*\d{1,2}\/\d{1,2})*$/;

export class CreateOltDeviceDto {
  @IsString()
  @Matches(NAME_RULE, {
    message:
      'Nama perangkat 3-64 karakter, hanya huruf/angka/spasi dan . _ : - serta tidak diawali/diakhiri simbol.',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,40}$/, {
    message: 'Vendor 2-40 karakter (huruf/angka/_/-). Contoh: vsol, global.',
  })
  vendor?: string;

  @IsOptional()
  @IsIn(['ssh', 'telnet'], { message: 'Transport harus ssh atau telnet.' })
  transport?: 'ssh' | 'telnet';

  @IsString()
  @Matches(HOST_RULE, { message: 'Host harus alamat IP atau nama host yang valid (tanpa spasi/skema).' })
  @MaxLength(128)
  host!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port harus angka bulat.' })
  @Min(1)
  @Max(65535)
  port?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  enable_password?: string;

  @IsOptional()
  @IsString()
  @Matches(PON_RULE, { message: 'Port PON harus berbentuk 0/1 atau daftar 0/1,0/2.' })
  pon_ports?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  prompt_pattern?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateOltDeviceDto {
  @IsOptional()
  @IsString()
  @Matches(NAME_RULE, {
    message:
      'Nama perangkat 3-64 karakter, hanya huruf/angka/spasi dan . _ : - serta tidak diawali/diakhiri simbol.',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,40}$/, { message: 'Vendor 2-40 karakter (huruf/angka/_/-).' })
  vendor?: string;

  @IsOptional()
  @IsIn(['ssh', 'telnet'], { message: 'Transport harus ssh atau telnet.' })
  transport?: 'ssh' | 'telnet';

  @IsOptional()
  @IsString()
  @Matches(HOST_RULE, { message: 'Host harus alamat IP atau nama host yang valid.' })
  @MaxLength(128)
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port harus angka bulat.' })
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  username?: string;

  /** Kosong = jangan ubah password yang tersimpan. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  enable_password?: string;

  @IsOptional()
  @IsString()
  @Matches(PON_RULE, { message: 'Port PON harus berbentuk 0/1 atau daftar 0/1,0/2.' })
  pon_ports?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  prompt_pattern?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  is_active?: boolean;
}
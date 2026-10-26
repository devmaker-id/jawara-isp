import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Aturan umum: nama perangkat dipakai sebagai kunci unik, host menerima IPv4
// atau nama DNS, dan password bersifat opsional saat update (kosong = jangan
// ubah). Password tidak pernah dikembalikan oleh API.

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

export class CreateDeviceDto {
  @IsString()
  @Matches(NAME_RULE, {
    message:
      'Nama perangkat 3-64 karakter, hanya huruf/angka/spasi dan . _ : - serta tidak diawali/diakhiri simbol.',
  })
  name!: string;

  @IsString()
  @Matches(HOST_RULE, { message: 'Host harus alamat IP atau nama host yang valid (tanpa spasi/skema).' })
  @MaxLength(128)
  host!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port API harus angka bulat.' })
  @Min(1, { message: 'Port API minimal 1.' })
  @Max(65535, { message: 'Port API maksimal 65535.' })
  api_port?: number;

  @IsString()
  @MinLength(1, { message: 'User API wajib diisi.' })
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'User API tidak boleh mengandung spasi/simbol aneh.' })
  api_user!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128, { message: 'Password API maksimal 128 karakter.' })
  api_password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^$|^(https?:\/\/)?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?(\/[^\s]*)?$/, {
    message: 'URL WebFig harus berupa http(s)://host[:port] tanpa spasi.',
  })
  gui_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean({ message: 'write_enabled harus true/false.' })
  write_enabled?: boolean;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean({ message: 'is_active harus true/false.' })
  is_active?: boolean;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @Matches(NAME_RULE, {
    message:
      'Nama perangkat 3-64 karakter, hanya huruf/angka/spasi dan . _ : - serta tidak diawali/diakhiri simbol.',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(HOST_RULE, { message: 'Host harus alamat IP atau nama host yang valid (tanpa spasi/skema).' })
  @MaxLength(128)
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port API harus angka bulat.' })
  @Min(1, { message: 'Port API minimal 1.' })
  @Max(65535, { message: 'Port API maksimal 65535.' })
  api_port?: number;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'User API tidak boleh kosong.' })
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'User API tidak boleh mengandung spasi/simbol aneh.' })
  api_user?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128, { message: 'Password API maksimal 128 karakter.' })
  api_password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^$|^(https?:\/\/)?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?(\/[^\s]*)?$/, {
    message: 'URL WebFig harus berupa http(s)://host[:port] tanpa spasi.',
  })
  gui_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean({ message: 'write_enabled harus true/false.' })
  write_enabled?: boolean;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean({ message: 'is_active harus true/false.' })
  is_active?: boolean;
}
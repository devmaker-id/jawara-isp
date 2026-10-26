import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const boolFromInput = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === '1' || value === 1 || value === true) return true;
  if (value === 'false' || value === '0' || value === 0 || value === false) return false;
  return value;
};

export class HotspotUserDto {
  @IsString()
  @Length(1, 64, { message: 'Nama user 1-64 karakter' })
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'Nama user hanya boleh huruf, angka, . _ @ -' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'Password maksimal 64 karakter' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  server?: string;

  // RouterOS memakai string uptime, mis. "1d", "04:00:00", "30m".
  @IsOptional()
  @IsString()
  @MaxLength(32)
  limit_uptime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateHotspotUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  limit_uptime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class PppSecretDto {
  @IsString()
  @Length(1, 64, { message: 'Nama PPP 1-64 karakter' })
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'Nama PPP hanya boleh huruf, angka, . _ @ -' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsOptional()
  @IsIn(['any', 'pppoe', 'pptp', 'l2tp', 'ovpn'], { message: 'Service harus any/pppoe/pptp/l2tp/ovpn' })
  service?: 'any' | 'pppoe' | 'pptp' | 'l2tp' | 'ovpn';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  remote_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdatePppSecretDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsOptional()
  @IsIn(['any', 'pppoe', 'pptp', 'l2tp', 'ovpn'])
  service?: 'any' | 'pppoe' | 'pptp' | 'l2tp' | 'ovpn';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  remote_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class InterfaceUpdateDto {
  @Transform(boolFromInput)
  @IsBoolean({ message: 'disabled harus true/false' })
  disabled!: boolean;
}
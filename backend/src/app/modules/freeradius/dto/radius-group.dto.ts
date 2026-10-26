import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Atribut yang boleh dikelola panel. Daftar ini sengaja sempit: hanya atribut
// yang dipakai bersama oleh FITUR hotspot/PPPoE MikroTik dan FreeRADIUS.
// Atribut di luar daftar ditolak, supaya panel tidak menjadi editor bebas
// untuk file/database RADIUS.
export const REPLY_ATTRIBUTES = [
  'Mikrotik-Rate-Limit',
  'Mikrotik-Group',
  'Session-Timeout',
  'Idle-Timeout',
  'Acct-Interim-Interval',
  'Framed-Pool',
  'Framed-IP-Address',
  'WISPr-Bandwidth-Max-Down',
  'WISPr-Bandwidth-Max-Up',
] as const;

export const CHECK_ATTRIBUTES = [
  'Simultaneous-Use',
  'Expiration',
  'Login-Time',
  'Max-Daily-Session',
] as const;

// Operator FreeRADIUS yang sah untuk kolom `op`.
export const ATTRIBUTE_OPS = ['=', ':=', '==', '+=', '!=', '>', '>=', '<', '<='] as const;

export class GroupAttributeDto {
  @IsIn(REPLY_ATTRIBUTES as unknown as string[], {
    message: `Atribut reply harus salah satu: ${REPLY_ATTRIBUTES.join(', ')}.`,
  })
  attribute!: string;

  @IsOptional()
  @IsIn(ATTRIBUTE_OPS as unknown as string[], { message: 'Operator atribut tidak valid.' })
  op?: string;

  @IsString()
  @MaxLength(190, { message: 'Nilai atribut maksimal 190 karakter.' })
  value!: string;
}

export class GroupCheckAttributeDto {
  @IsIn(CHECK_ATTRIBUTES as unknown as string[], {
    message: `Atribut check harus salah satu: ${CHECK_ATTRIBUTES.join(', ')}.`,
  })
  attribute!: string;

  @IsOptional()
  @IsIn(ATTRIBUTE_OPS as unknown as string[], { message: 'Operator atribut tidak valid.' })
  op?: string;

  @IsString()
  @MaxLength(190, { message: 'Nilai atribut maksimal 190 karakter.' })
  value!: string;
}

export class SaveGroupDto {
  // Nama grup dipakai sebagai kunci di tiga tabel RADIUS sekaligus.
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, {
    message: 'Nama grup hanya boleh huruf, angka, titik, garis bawah, dan strip (maks 64).',
  })
  groupname!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'Maksimal 20 atribut reply per grup.' })
  @ValidateNested({ each: true })
  @Type(() => GroupAttributeDto)
  reply?: GroupAttributeDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'Maksimal 20 atribut check per grup.' })
  @ValidateNested({ each: true })
  @Type(() => GroupCheckAttributeDto)
  check?: GroupCheckAttributeDto[];
}

export class AssignGroupDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._@-]{1,64}$/, { message: 'Username tidak valid.' })
  username!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{0,64}$/, { message: 'Nama grup tidak valid.' })
  groupname?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Prioritas harus angka bulat.' })
  @Min(1)
  @Max(100)
  priority?: number;
}

export class GroupListItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;
}

// Perbandingan grup RADIUS dengan profil di MikroTik.
export class ParityQueryDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hotspot?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  device?: number;
}

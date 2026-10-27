import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Nilai yang sah untuk `nas.ros_version`. */
const ROS_VERSIONS = ['6', '7'] as const;

export class ListNasQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
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
  // Batas mengikuti pilihan "tampilkan" di panel: 25/50/100/500/1000.
  @Max(1000)
  limit?: number;
}

export class CreateNasDto {
  // Bila device_id diisi, alamat NAS diambil dari perangkat (IP sumber paket
  // RADIUS), bukan dari kolom ini.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  device_id?: number;

  @IsOptional()
  @IsString()
  @Length(1, 128, { message: 'Alamat NAS 1-128 karakter' })
  nasname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  shortname?: string;

  // Secret RADIUS: minimal 8 karakter agar tidak lemah.
  @IsString()
  @Length(8, 60, { message: 'Secret NAS 8-60 karakter' })
  secret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  ports?: number;

  // Perilaku RADIUS berbeda: ROS 7 mewajibkan Message-Authenticator, ROS 6 tidak.
  @IsOptional()
  @IsIn(ROS_VERSIONS, { message: 'Versi RouterOS harus 6 atau 7' })
  ros_version?: '6' | '7';
}

export class UpdateNasDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  shortname?: string;

  @IsOptional()
  @IsString()
  @Length(8, 60, { message: 'Secret NAS 8-60 karakter' })
  secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  ports?: number;

  // Perilaku RADIUS berbeda: ROS 7 mewajibkan Message-Authenticator, ROS 6 tidak.
  @IsOptional()
  @IsIn(ROS_VERSIONS, { message: 'Versi RouterOS harus 6 atau 7' })
  ros_version?: '6' | '7';
}

export class ListRadiusUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
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
  // Batas mengikuti pilihan "tampilkan" di panel: 25/50/100/500/1000.
  @Max(1000)
  limit?: number;
}

export class CreateRadiusUserDto {
  @IsString()
  @Length(1, 64, { message: 'Username 1-64 karakter' })
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'Username hanya boleh huruf, angka, . _ @ -' })
  username!: string;

  @IsString()
  @Length(1, 128, { message: 'Password 1-128 karakter' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  disabled?: boolean;
}

// Filter halaman Log Autentikasi. `search` mencakup nama user, MAC, dan IP klien.
export class ListAuthLogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  nas?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  mac?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  iface?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  station?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  reply?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class UpdateRadiusUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 128, { message: 'Password 1-128 karakter' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  group?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  disabled?: boolean;
}
/**
 * Cek pemakaian user (dialog "Cek pemakaian user").
 * Password/kredensial TIDAK pernah ikut: hanya identitas layanan dan angka pemakaian.
 */
export class UsageLookupQueryDto {
  @IsIn(['customer', 'voucher'], { message: 'Pilih jenis: pelanggan atau voucher' })
  type!: 'customer' | 'voucher';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  mac?: string;
}

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** IPv4 bertitik sederhana; validasi rentang dilakukan service. */
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export class UpdateIsolirDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Nama grup ini menjadi kunci radgroupreply sekaligus nama profil PPP lokal.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, {
    message: 'Nama grup isolir hanya huruf, angka, titik, garis bawah, strip (maks 64).',
  })
  group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pool_name?: string;

  @IsOptional()
  @Matches(/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\/([0-9]|[12]\d|3[0-2])$/, {
    message: 'CIDR isolir harus format 10.127.0.0/18.',
  })
  cidr?: string;

  @IsOptional()
  @Matches(IPV4, { message: 'Gateway isolir harus alamat IPv4 yang valid.' })
  gateway?: string;

  @IsOptional()
  @Matches(IPV4, { message: 'IP awal pool isolir harus alamat IPv4 yang valid.' })
  range_start?: string;

  @IsOptional()
  @Matches(IPV4, { message: 'IP akhir pool isolir harus alamat IPv4 yang valid.' })
  range_end?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  rate_limit?: string;

  // Halaman isolir: boleh kosong (berarti redirect belum disiapkan).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  message?: string;
}

export class ProvisionIsolirDto {
  @Type(() => Number)
  @IsInt({ message: 'device_id harus angka.' })
  @Min(1, { message: 'Pilih perangkat dulu.' })
  device_id!: number;
}

export class IsolateUserDto {
  @IsString()
  @MaxLength(64)
  username!: string;

  @IsOptional()
  @IsIn(['time', 'quota', 'validity', 'bill'], {
    message: 'Alasan harus time, quota, validity, atau bill.',
  })
  reason?: 'time' | 'quota' | 'validity' | 'bill';
}

export class ReleaseUserDto {
  @IsString()
  @MaxLength(64)
  username!: string;
}

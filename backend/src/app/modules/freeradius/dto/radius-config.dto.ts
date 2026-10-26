import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

// Spesifikasi konfigurasi FreeRADIUS yang boleh dikirim dari panel.
// Helper di server memvalidasi ulang; DTO ini mencegah input jelas salah lebih
// awal dan menjaga pesan galat tetap bisa dibaca pengguna.
export class RadiusConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\*|[0-9a-fA-F:.]{2,45})$/, {
    message: 'Alamat listen harus "*" atau alamat IP.',
  })
  listen_address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port auth harus angka bulat.' })
  @Min(1, { message: 'Port auth minimal 1.' })
  @Max(65535, { message: 'Port auth maksimal 65535.' })
  auth_port?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port acct harus angka bulat.' })
  @Min(1, { message: 'Port acct minimal 1.' })
  @Max(65535, { message: 'Port acct maksimal 65535.' })
  acct_port?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,255}$/, { message: 'Host database tidak valid.' })
  db_host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Port database harus angka bulat.' })
  @Min(1)
  @Max(65535)
  db_port?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_]{1,64}$/, { message: 'Nama database tidak valid.' })
  db_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_]{1,32}$/, { message: 'User database tidak valid.' })
  db_user?: string;

  @IsOptional()
  @IsBoolean({ message: 'read_clients harus benar atau salah.' })
  read_clients?: boolean;

  // Nama zona dari basis data zona waktu sistem (mis. Asia/Jakarta).
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/, {
    message: 'Zona waktu harus nama zona sistem, misalnya Asia/Jakarta.',
  })
  timezone?: string;
}

export class RadiusServiceActionDto {
  @IsIn(['start', 'stop', 'restart', 'reload'], {
    message: 'Aksi harus salah satu: start, stop, restart, reload.',
  })
  action!: 'start' | 'stop' | 'restart' | 'reload';
}

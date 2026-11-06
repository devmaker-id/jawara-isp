import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  MinLength,
  ValidateNested,
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
/**
 * Pemasangan ONU ke pelanggan.
 *
 * Pelanggan ditunjuk lewat `internet_no` (cara teknisi bekerja) atau
 * `customer_id`. Minimal salah satu wajib; kalau tidak, service menolak.
 */
export class AssignOnuDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'customer_id harus angka.' })
  @Min(1, { message: 'customer_id tidak valid.' })
  customer_id?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{4,20}$/, { message: 'Nomor Internet harus 4-20 digit angka.' })
  internet_no?: string;

  @IsOptional()
  @IsBoolean()
  move?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Catatan maksimal 255 karakter.' })
  note?: string;
}

export class ReleaseOnuDto {
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Catatan maksimal 255 karakter.' })
  note?: string;
}

/**
 * Terapkan konfigurasi Syslog Client pada satu perangkat OLT.
 *
 * `collector_ip` wajib saat `enabled=true`; diabaikan saat menonaktifkan.
 * `events` (khusus VSOL) berupa daftar "event <name>" / "alarm <name>";
 * bila kosong, driver memakai daftar bawaan untuk monitoring ONU.
 */
export class SetSyslogClientDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'IP kolektor tidak valid.' })
  collector_ip?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];
}

/** Hapus banyak event log ONU sekaligus (id). */
export class DeleteSyslogEventsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Pilih minimal satu log untuk dihapus.' })
  @IsInt({ each: true })
  ids!: number[];
}

/**
 * Atur kebijakan retensi log ONU (penghapusan terjadwal).
 *
 * `mode=age`   → `days` wajib (1–365).
 * `mode=per_olt` → `count` wajib (1–100000, pertahankan N terbaru per OLT).
 */
export class SetSyslogRetentionDto {
  @IsIn(['age', 'per_olt'], { message: 'mode harus age atau per_olt.' })
  mode!: 'age' | 'per_olt';

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days harus angka bulat.' })
  @Min(1, { message: 'days minimal 1.' })
  @Max(365, { message: 'days maksimal 365.' })
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'count harus angka bulat.' })
  @Min(1, { message: 'count minimal 1.' })
  @Max(100000, { message: 'count maksimal 100000.' })
  count?: number;
}

/** Satu rute alert: syslog dari OLT (olt_id) dikirim ke grup WhatsApp. */
export class SyslogRouteDto {
  @IsInt({ message: 'olt_id harus angka bulat.' })
  @Type(() => Number)
  olt_id!: number;

  @IsString()
  @MaxLength(64, { message: 'ID grup WhatsApp maksimal 64 karakter.' })
  whatsapp_group!: string;
}

/** Konfigurasi handler event ONU (inventori + alert WhatsApp). */
export class SetSyslogHandlerConfigDto {
  @IsOptional()
  @IsBoolean()
  inventory_sync?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsapp_alert?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyslogRouteDto)
  routes?: SyslogRouteDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  alert_events?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'spacing_seconds harus angka bulat.' })
  @Min(1, { message: 'spacing_seconds minimal 1 detik.' })
  @Max(3600, { message: 'spacing_seconds maksimal 3600 detik.' })
  spacing_seconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'flap_threshold harus angka bulat.' })
  @Min(1, { message: 'flap_threshold minimal 1.' })
  @Max(100, { message: 'flap_threshold maksimal 100.' })
  flap_threshold?: number;
}

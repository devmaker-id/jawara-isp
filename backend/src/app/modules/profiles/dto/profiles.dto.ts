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
  ValidateIf,
} from 'class-validator';

// ============================================================================
// DTO untuk Bandwidth, Group Profile, Profile Hotspot/PPP, dan Voucher.
// Batas di sini adalah lapisan pertama; aturan bisnis (mis. shared vs pool)
// ditegakkan lagi di service supaya tidak bisa dilewati lewat API.
// ============================================================================

export const TIME_UNITS = ['minute', 'hour', 'day', 'month'] as const;
export const QUOTA_UNITS = ['MB', 'GB'] as const;
export const LOGIN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const PROFILE_TYPES = ['hotspot', 'ppp'] as const;
export const POOL_MODES = ['mikrotik-pool', 'sql-ippool'] as const;
export const VOUCHER_STATUS = ['new-created', 'ready-to-use', 'active', 'expired'] as const;
// voucher = username sama dengan password (dibagikan di kertas).
// member  = akun langganan ber-username DAN password, terikat pelanggan.
export const USER_TYPES = ['voucher', 'member'] as const;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$/;

// ---------------------------------------------------------------------------
// Bandwidth
// ---------------------------------------------------------------------------
export class CreateBandwidthDto {
  @IsString()
  @Matches(NAME_PATTERN, { message: 'Nama bandwidth tidak valid (maks 64 karakter).' })
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Min upload harus angka Kbps.' })
  @Min(0, { message: 'Min upload tidak boleh negatif.' })
  min_upload_kbps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Min download harus angka Kbps.' })
  @Min(0, { message: 'Min download tidak boleh negatif.' })
  min_download_kbps?: number;

  @Type(() => Number)
  @IsInt({ message: 'Max upload wajib diisi (Kbps).' })
  @Min(1, { message: 'Max upload minimal 1 Kbps.' })
  max_upload_kbps!: number;

  @Type(() => Number)
  @IsInt({ message: 'Max download wajib diisi (Kbps).' })
  @Min(1, { message: 'Max download minimal 1 Kbps.' })
  max_download_kbps!: number;

  @IsOptional()
  @IsBoolean()
  burst_enabled?: boolean;

  @ValidateIf((dto) => dto.burst_enabled === true)
  @Type(() => Number)
  @IsInt({ message: 'Burst upload harus angka Kbps.' })
  @Min(1)
  burst_upload_kbps?: number;

  @ValidateIf((dto) => dto.burst_enabled === true)
  @Type(() => Number)
  @IsInt({ message: 'Burst download harus angka Kbps.' })
  @Min(1)
  burst_download_kbps?: number;

  @ValidateIf((dto) => dto.burst_enabled === true)
  @Type(() => Number)
  @IsInt({ message: 'Threshold upload harus angka Kbps.' })
  @Min(1)
  burst_threshold_upload_kbps?: number;

  @ValidateIf((dto) => dto.burst_enabled === true)
  @Type(() => Number)
  @IsInt({ message: 'Threshold download harus angka Kbps.' })
  @Min(1)
  burst_threshold_download_kbps?: number;

  @ValidateIf((dto) => dto.burst_enabled === true)
  @Type(() => Number)
  @IsInt({ message: 'Burst time harus angka detik.' })
  @Min(1)
  @Max(60, { message: 'Burst time maksimal 60 detik.' })
  burst_time_sec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Prioritas 1 sampai 8.' })
  @Max(8, { message: 'Prioritas 1 sampai 8.' })
  priority?: number;
}

export class UpdateBandwidthDto {
  @IsOptional()
  @IsString()
  @Matches(NAME_PATTERN, { message: 'Nama bandwidth tidak valid.' })
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_upload_kbps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_download_kbps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_upload_kbps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_download_kbps?: number;

  @IsOptional()
  @IsBoolean()
  burst_enabled?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) burst_upload_kbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) burst_download_kbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) burst_threshold_upload_kbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) burst_threshold_download_kbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) burst_time_sec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  priority?: number;
}

// ---------------------------------------------------------------------------
// Group Profile
// ---------------------------------------------------------------------------
export class CreateGroupProfileDto {
  @IsString()
  @Matches(NAME_PATTERN, { message: 'Nama grup tidak valid (maks 64 karakter).' })
  name!: string;

  @IsIn(PROFILE_TYPES as unknown as string[], {
    message: 'Type grup harus hotspot atau ppp.',
  })
  type!: 'hotspot' | 'ppp';

  @Type(() => Number)
  @IsInt({ message: 'Router wajib dipilih.' })
  @Min(1, { message: 'Router wajib dipilih.' })
  router_id!: number;

  @IsOptional()
  @IsIn(POOL_MODES as unknown as string[], {
    message: 'Mode pool harus mikrotik-pool atau sql-ippool.',
  })
  pool_mode?: 'mikrotik-pool' | 'sql-ippool';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  mikrotik_pool_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  dns_primary?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  dns_secondary?: string | null;

  // Ditulis manual dan harus sama dengan nama parent queue di MikroTik.
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'Nama parent queue maksimal 64 karakter.' })
  parent_queue?: string | null;

  @IsOptional()
  @IsBoolean()
  use_router_default?: boolean;
}

export class UpdateGroupProfileDto extends CreateGroupProfileDto {
  @IsOptional()
  @IsString()
  @Matches(NAME_PATTERN, { message: 'Nama grup tidak valid.' })
  declare name: string;

  @IsOptional()
  @IsIn(PROFILE_TYPES as unknown as string[])
  declare type: 'hotspot' | 'ppp';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare router_id: number;
}

// ---------------------------------------------------------------------------
// Profile Hotspot / PPP
// ---------------------------------------------------------------------------
export class CreateServiceProfileDto {
  @IsString()
  @Matches(NAME_PATTERN, { message: 'Nama profil tidak valid (maks 64 karakter).' })
  name!: string;

  @Type(() => Number)
  @IsInt({ message: 'Group profile wajib dipilih.' })
  @Min(1, { message: 'Group profile wajib dipilih.' })
  group_profile_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'Bandwidth wajib dipilih.' })
  @Min(1, { message: 'Bandwidth wajib dipilih.' })
  bandwidth_id!: number;

  @Type(() => Number)
  @Min(0, { message: 'Harga modal tidak boleh negatif.' })
  cost_price!: number;

  @Type(() => Number)
  @Min(0, { message: 'Harga jual tidak boleh negatif.' })
  sell_price!: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'Harga promo tidak boleh negatif.' })
  promo_price?: number;

  // 0 = tanpa PPN; 11 = harga jual dinaikkan 11%.
  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: 'PPN minimal 0%.' })
  @Max(100, { message: 'PPN maksimal 100%.' })
  tax_percent?: number;

  @IsOptional()
  @IsIn(['unlimited', 'limited'], { message: 'Tipe kuota harus unlimited atau limited.' })
  quota_type?: 'unlimited' | 'limited';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timebase_value?: number | null;

  @IsOptional()
  @IsIn(TIME_UNITS as unknown as string[])
  timebase_unit?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotabase_value?: number | null;

  @IsOptional()
  @IsIn(QUOTA_UNITS as unknown as string[])
  quotabase_unit?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Masa aktif harus angka; 0 berarti tanpa batas.' })
  @Min(0)
  validity_value?: number;

  @IsOptional()
  @IsIn(TIME_UNITS as unknown as string[])
  validity_unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Shared user harus angka.' })
  @Min(1)
  @Max(50, { message: 'Shared user maksimal 50.' })
  shared_users?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Prioritas 1 sampai 8.' })
  @Max(8, { message: 'Prioritas 1 sampai 8.' })
  priority?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(LOGIN_DAYS as unknown as string[], { each: true, message: 'Hari login tidak valid.' })
  login_days?: string[] | null;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Jam mulai harus format HH:MM.' })
  login_start?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Jam selesai harus format HH:MM.' })
  login_end?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateServiceProfileDto extends CreateServiceProfileDto {
  @IsOptional()
  @IsString()
  @Matches(NAME_PATTERN, { message: 'Nama profil tidak valid.' })
  declare name: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) declare group_profile_id: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) declare bandwidth_id: number;
  @IsOptional() @Type(() => Number) @Min(0) declare cost_price: number;
  @IsOptional() @Type(() => Number) @Min(0) declare sell_price: number;
}

// ---------------------------------------------------------------------------
// Voucher
// ---------------------------------------------------------------------------
export class GenerateVoucherDto {
  @IsIn(PROFILE_TYPES as unknown as string[], { message: 'Tipe profil harus hotspot atau ppp.' })
  profile_type!: 'hotspot' | 'ppp';

  // voucher  = akun lepas, tanpa pelanggan
  // member = akun langganan milik satu pelanggan (customer_id wajib)
  @IsIn(USER_TYPES as unknown as string[], {
    message: 'Tipe user harus voucher atau member.',
  })
  user_type!: 'voucher' | 'member';

  @Type(() => Number)
  @IsInt({ message: 'Profil wajib dipilih.' })
  @Min(1)
  profile_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'Jumlah voucher harus angka.' })
  @Min(1, { message: 'Minimal 1 voucher.' })
  @Max(200, { message: 'Maksimal 200 voucher sekali buat.' })
  count!: number;

  // 4-12 karakter. Kosong = dibuat otomatis.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'Panjang username 4-12 huruf/angka.' })
  username_prefix?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,12}$/, { message: 'Panjang password 4-12 huruf/angka.' })
  password?: string;

  // Wajib untuk tipe member; harus kosong untuk tipe voucher.
  @ValidateIf((dto: GenerateVoucherDto) => dto.user_type === 'member')
  @Type(() => Number)
  @IsInt({ message: 'Pelanggan wajib dipilih untuk tipe customer.' })
  @Min(1, { message: 'Pelanggan wajib dipilih untuk tipe customer.' })
  customer_id?: number;

  // Tipe member: akun langsung diserahkan (siap pakai) tanpa lewat voucher.
  @IsOptional()
  @IsBoolean()
  ready?: boolean;
}

export class ListVoucherQueryDto {
  @IsOptional()
  @IsIn(PROFILE_TYPES as unknown as string[])
  profile_type?: string;

  @IsOptional()
  @IsIn(USER_TYPES as unknown as string[])
  user_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  profile_id?: number;

  @IsOptional()
  @IsIn(VOUCHER_STATUS as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  // Pemilik data (pembuat akun) — dipakai untuk mencetak per reseller/operator.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  created_by?: number;

  // Rentang tanggal pembuatan (YYYY-MM-DD), inklusif.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tanggal harus format YYYY-MM-DD' })
  date_from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tanggal harus format YYYY-MM-DD' })
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class UpdateVoucherStatusDto {
  @IsIn(VOUCHER_STATUS as unknown as string[], { message: 'Status voucher tidak valid.' })
  status!: 'new-created' | 'ready-to-use' | 'active' | 'expired';
}

export class RemoveVouchersDto {
  @IsArray()
  @ArrayMaxSize(200, { message: 'Maksimal 200 voucher sekali hapus.' })
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[];
}

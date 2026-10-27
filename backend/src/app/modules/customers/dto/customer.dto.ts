import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CUSTOMER_STATUSES, CustomerStatus } from '../customer-radius';

// Username RADIUS: huruf/angka/titik/strip/garis bawah/@, 3-64 karakter.
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{2,63}$/;


/**
 * Data akun RADIUS yang dibuat bersama pelanggan.
 *
 * Satu pelanggan = satu akun saat pembuatan. `profile_type` menentukan daftar
 * profil mana yang boleh dipilih (hotspot atau ppp).
 *
 * Limitasi TIDAK di sini: batas waktu dan kuota melekat pada profil layanan
 * (grup RADIUS) dan ditulis ke radgroupreply — keputusan final.
 */
export class CustomerAccountDto {
  @IsIn(['hotspot', 'ppp'], { message: 'Tipe layanan harus hotspot atau ppp.' })
  profile_type!: 'hotspot' | 'ppp';

  @Type(() => Number)
  @IsInt({ message: 'Profil wajib dipilih.' })
  @Min(1, { message: 'Profil wajib dipilih.' })
  profile_id!: number;

  @IsString()
  @Matches(USERNAME_PATTERN, {
    message: 'Username 3-64 karakter, hanya huruf/angka/titik/strip/garis bawah/@.',
  })
  username!: string;

  // Kosong = dibuat otomatis; password ditampilkan sekali setelah disimpan.
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'Password maksimal 64 karakter.' })
  password?: string;

}

/**
 * Perubahan akun lewat PATCH: semua field opsional.
 *
 * `username` sengaja tidak ada — ia identitas login dan kunci riwayat radacct,
 * jadi tidak diubah. Ganti username = buat akun baru.
 */
export class UpdateCustomerAccountDto {
  @IsOptional()
  @IsIn(['hotspot', 'ppp'], { message: 'Tipe layanan harus hotspot atau ppp.' })
  profile_type?: 'hotspot' | 'ppp';

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Profil harus angka.' })
  @Min(1, { message: 'Profil tidak valid.' })
  profile_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'Password maksimal 64 karakter.' })
  password?: string;

}

export class CreateCustomerDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsEmail({}, { message: 'Email tidak valid.' })
  email!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  // Pemilik data. Hanya ADMIN yang boleh mengisi ini; untuk role lain nilainya
  // ditimpa menjadi akun yang login. Bila admin mengosongkannya, pemilik
  // diwarisi dari profil layanan yang dipilih.
  @IsOptional()
  @ValidateIf((o: CreateCustomerDto) => o.owner_id !== null)
  @Type(() => Number)
  @IsInt({ message: 'owner_id harus angka atau null.' })
  @Min(1, { message: 'owner_id tidak valid.' })
  owner_id?: number | null;

  @IsOptional()
  @IsIn(CUSTOMER_STATUSES as unknown as string[], {
    message: 'Status harus active, expired, suspend, atau disable.',
  })
  status?: CustomerStatus;

  // Akun RADIUS. Opsional agar pelanggan lama/tanpa layanan tetap bisa dibuat.
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerAccountDto)
  account?: CustomerAccountDto;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email tidak valid.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsIn(CUSTOMER_STATUSES as unknown as string[], {
    message: 'Status harus active, expired, suspend, atau disable.',
  })
  status?: CustomerStatus;

  // Perubahan akun: hanya field yang dikirim yang diubah.
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCustomerAccountDto)
  account?: UpdateCustomerAccountDto;
}

export class UpdateCustomerStatusDto {
  @IsIn(CUSTOMER_STATUSES as unknown as string[], {
    message: 'Status harus active, expired, suspend, atau disable.',
  })
  status!: CustomerStatus;
}

// Query daftar pelanggan (Fase 0: pagination & pencarian di server).
export class ListCustomersQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'status harus active atau inactive.' })
  status?: 'active' | 'inactive';

  // Status pelanggan yang sebenarnya (active/expired/suspend/disable).
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES as unknown as string[], {
    message: 'state harus active, expired, suspend, atau disable.',
  })
  state?: CustomerStatus;

  @IsOptional()
  @IsIn(['hotspot', 'ppp'], { message: 'profile harus hotspot atau ppp.' })
  profile?: 'hotspot' | 'ppp';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Batas mengikuti pilihan "tampilkan" di panel: 25/50/100/500/1000.
  @Max(1000)
  @IsOptional()
  limit?: number;
}

// Penetapan pemilik. `owner_id: null` berarti melepas penugasan.
export class AssignOwnerDto {
  @ValidateIf((o: AssignOwnerDto) => o.owner_id !== null)
  @Type(() => Number)
  @IsInt({ message: 'owner_id harus berupa angka atau null' })
  @Min(1, { message: 'owner_id tidak valid' })
  owner_id!: number | null;
}

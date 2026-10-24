import { IsString, IsNumber, IsBoolean, IsOptional, IsInt, Min, MaxLength, Length } from 'class-validator';

// Batas atas mengikuti ukuran kolom: name VARCHAR(100), data_limit VARCHAR(30).
// price DECIMAL(12,2) → panjang total maksimum 12 digit.
const MAX_PRICE = 9_999_999_999.99;

export class CreatePackageDto {
  @IsString()
  @Length(2, 100, { message: 'name harus 2-100 karakter' })
  name: string;

  @IsString()
  @MaxLength(5000, { message: 'description terlalu panjang' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price maksimal 2 angka desimal' })
  @Min(0, { message: 'price tidak boleh negatif' })
  price: number;

  @IsString()
  @Length(1, 30, { message: 'data_limit harus 1-30 karakter' })
  data_limit: string;

  @IsInt({ message: 'speed harus bilangan bulat' })
  @Min(1, { message: 'speed minimal 1' })
  speed: number;

  @IsInt({ message: 'valid_days harus bilangan bulat' })
  @Min(1, { message: 'valid_days minimal 1' })
  valid_days: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdatePackageDto {
  @IsString()
  @IsOptional()
  @Length(2, 100, { message: 'name harus 2-100 karakter' })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000, { message: 'description terlalu panjang' })
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price maksimal 2 angka desimal' })
  @IsOptional()
  @Min(0, { message: 'price tidak boleh negatif' })
  price?: number;

  @IsString()
  @IsOptional()
  @Length(1, 30, { message: 'data_limit harus 1-30 karakter' })
  data_limit?: string;

  @IsInt({ message: 'speed harus bilangan bulat' })
  @IsOptional()
  @Min(1, { message: 'speed minimal 1' })
  speed?: number;

  @IsInt({ message: 'valid_days harus bilangan bulat' })
  @IsOptional()
  @Min(1, { message: 'valid_days minimal 1' })
  valid_days?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export { MAX_PRICE };

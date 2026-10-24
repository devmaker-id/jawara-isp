import { IsString, IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class CreatePackageDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsNumber()
  price: number;

  @IsString()
  data_limit: string;

  @IsNumber()
  speed: number;

  @IsNumber()
  valid_days: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdatePackageDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  data_limit?: string;

  @IsNumber()
  @IsOptional()
  speed?: number;

  @IsNumber()
  @IsOptional()
  valid_days?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

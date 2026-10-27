import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Isi file dikirim sebagai teks di body JSON (bukan multipart) supaya tidak
// perlu parser upload terpisah. Batas ukuran diatur di main.ts.
export class ImportDatabaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  table?: string;

  @IsIn(['csv', 'sql'], { message: 'format harus csv atau sql' })
  format!: 'csv' | 'sql';

  @IsString()
  @MinLength(1, { message: 'isi file kosong' })
  content!: string;

  @IsOptional()
  @IsIn(['append', 'replace'], { message: 'mode harus append atau replace' })
  mode?: 'append' | 'replace';
}

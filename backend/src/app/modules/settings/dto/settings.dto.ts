import { IsObject } from 'class-validator';

// Nilai divalidasi di service: kunci harus ada di SETTING_KEYS, nilai harus
// string (semua kolom config_value bertipe TEXT).
export class UpdateSettingsDto {
  @IsObject({ message: 'values wajib berupa objek' })
  values: Record<string, unknown>;
}

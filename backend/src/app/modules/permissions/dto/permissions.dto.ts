import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * Daftar izin yang harus AKTIF untuk satu akun.
 *
 * Dikirim sebagai daftar lengkap (bukan diff) supaya UI checkbox cukup
 * mengirim keadaan akhir; backend yang menghitung selisihnya terhadap default
 * role dan hanya menyimpan yang benar-benar berbeda.
 */
export class SetPermissionsDto {
  @IsArray()
  @ArrayMaxSize(200, { message: 'Terlalu banyak izin dalam satu permintaan.' })
  @IsString({ each: true, message: 'Setiap izin harus berupa kode teks.' })
  @MaxLength(48, { each: true, message: 'Kode izin maksimal 48 karakter.' })
  codes!: string[];
}

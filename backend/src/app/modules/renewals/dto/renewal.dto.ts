import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const RENEWAL_METHODS = ['cash', 'transfer', 'qris', 'other'] as const;
export type RenewalMethod = (typeof RENEWAL_METHODS)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 9_999_999_999.99;

/** Pratinjau perpanjangan (GET). Semua opsional: tanpa profil = paket saat ini. */
export class RenewalPreviewQueryDto {
  @IsOptional()
  @IsString({ message: 'username harus teks' })
  @MaxLength(64, { message: 'username maksimal 64 karakter' })
  username?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'profile_id harus bilangan bulat' })
  @Min(1, { message: 'profile_id tidak valid' })
  profile_id?: number;
}

export class RenewCustomerDto extends RenewalPreviewQueryDto {
  /**
   * cash  = bayar langsung (wajib lunas, method wajib)
   * credit = piutang (hanya admin; tidak ada pembayaran saat transaksi)
   */
  @IsOptional()
  @IsIn(['cash', 'credit'], { message: 'payment_mode harus cash atau credit' })
  payment_mode?: 'cash' | 'credit';

  @IsOptional()
  @IsIn(RENEWAL_METHODS as unknown as string[], {
    message: 'method harus cash, transfer, qris, atau other',
  })
  method?: RenewalMethod;

  // Jatuh tempo piutang. Bila kosong: hari ini + batas bawaan sistem.
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'due_date harus format YYYY-MM-DD' })
  due_date?: string;

  @IsOptional()
  @IsString({ message: 'reference harus teks' })
  @MaxLength(64, { message: 'reference maksimal 64 karakter' })
  reference?: string;

  @IsOptional()
  @IsString({ message: 'note harus teks' })
  @MaxLength(255, { message: 'note maksimal 255 karakter' })
  note?: string;

  // Nominal boleh ditimpa (mis. diskon counter), tetapi tidak boleh melebihi
  // harga paket + pajak.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount maksimal 2 angka desimal' })
  @Min(0.01, { message: 'amount minimal 0.01' })
  @Max(MAX_AMOUNT, { message: 'amount melebihi kapasitas kolom DECIMAL(12,2)' })
  amount?: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'paid_at harus format YYYY-MM-DD' })
  paid_at?: string;

  // Kunci idempoten WAJIB: kirim ulang kunci yang sama tidak menagih dua kali.
  @IsString({ message: 'idempotency_key wajib berupa teks' })
  @MinLength(8, { message: 'idempotency_key minimal 8 karakter' })
  @MaxLength(64, { message: 'idempotency_key maksimal 64 karakter' })
  idempotency_key!: string;
}
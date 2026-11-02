import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Pencatatan penjualan voucher.
 *
 * Harga modal dan harga jual WAJIB dikirim: tanpa keduanya, laba tidak bisa
 * dihitung dan laporan hanya jadi angka omzet yang menyesatkan. Harga jual 0
 * tetap sah (voucher gratisan/promo), jadi yang divalidasi adalah "angka, tidak
 * negatif", bukan "lebih dari nol".
 */

export const SALE_METHODS = ['cash', 'transfer', 'qris', 'other'] as const;
export type SaleMethod = (typeof SALE_METHODS)[number];

const toInt = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : value;
};

export class CreateVoucherSaleDto {
  /** ID voucher yang dijual; opsional bila penjualan dicatat borongan. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'voucher_id harus angka.' })
  @Min(1, { message: 'voucher_id tidak valid.' })
  voucher_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  /**
   * Opsional bila `voucher_id` dikirim: nama profil diambil dari data voucher.
   * Tanpa keduanya, service menolak karena tidak ada yang bisa dicatat.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  profile_name?: string;

  @IsOptional()
  @IsIn(['hotspot', 'ppp'], { message: 'profile_type harus hotspot atau ppp.' })
  profile_type?: 'hotspot' | 'ppp';

  @IsOptional()
  @Transform(toInt)
  @IsInt({ message: 'Jumlah harus angka bulat.' })
  @Min(1, { message: 'Jumlah minimal 1.' })
  quantity?: number;

  /** Opsional bila `voucher_id` dikirim: modal diambil dari data voucher. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Harga modal harus angka.' })
  @Min(0, { message: 'Harga modal tidak boleh negatif.' })
  cost_price?: number;

  /**
   * Harga jual. Bila kosong dan `voucher_id` dikirim, dipakai harga voucher;
   * bila tetap kosong nilainya 0 (voucher gratisan tetap sah).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Harga jual harus angka.' })
  @Min(0, { message: 'Harga jual tidak boleh negatif.' })
  sell_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  buyer_name?: string;

  @IsOptional()
  @IsIn(SALE_METHODS as unknown as string[], {
    message: 'Metode harus cash, transfer, qris, atau other.',
  })
  method?: SaleMethod;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  note?: string;

  /** Hanya admin yang boleh mengisi; role lain selalu menjadi pemiliknya. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'owner_id harus angka.' })
  @Min(1, { message: 'owner_id tidak valid.' })
  owner_id?: number;
}

export class VoidSaleDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  reason?: string;
}

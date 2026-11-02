import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { RequestScope } from '../auth/request-scope';
import { CreateVoucherSaleDto, VoidSaleDto } from './dto/sale.dto';
import { SaleFilter, VoucherSalesRepository } from './voucher-sales.repository';

/**
 * Penjualan voucher + rekap pendapatan.
 *
 * Pendapatan = uang masuk dari dua sumber: tagihan member/pelanggan (`payments`)
 * dan penjualan voucher (`voucher_sales`). Angka ini TIDAK diambil dari
 * aktivitas jaringan seperti login pertama voucher — itu hanya penanda mulai
 * masa aktif.
 *
 * Cakupan (scope) berlaku di SQL, bukan filter di memori:
 *   admin    → semua pemilik/role
 *   operator → yang ia catat atau yang ia miliki
 *   reseller → hanya miliknya
 */

export interface SaleActor {
  userId: number;
  ip: string;
  role?: string;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: VoucherSalesRepository,
  ) {}

  /**
   * Pemilik data penjualan.
   *
   * Admin boleh menunjuk akun lain (mis. mencatat penjualan milik reseller);
   * role lain selalu menjadi pemilik catatannya sendiri, nilai dari body
   * diabaikan. Aturan ini sama dengan modul profil & voucher.
   */
  private async resolveOwner(actor: SaleActor, requested?: number): Promise<number> {
    if (actor.role !== 'admin') return actor.userId;
    if (requested === undefined || requested === null) return actor.userId;

    const row = await this.db.queryOne<{ id: number; is_active: number }>(
      'SELECT id, is_active FROM users WHERE id = ?',
      [requested],
    );
    if (!row) throw new BadRequestException(`Akun pemilik #${requested} tidak ditemukan.`);
    if (Number(row.is_active) !== 1) {
      throw new BadRequestException(`Akun pemilik #${requested} tidak aktif.`);
    }
    return requested;
  }

  /**
   * Catat satu penjualan voucher.
   *
   * Harga modal diambil dari data voucher bila tidak dikirim, karena menjual
   * di bawah modal tanpa sadar adalah kesalahan yang mahal. Harga jual tetap
   * wajib dari pemanggil (boleh beda dari harga profil, mis. diskon warung).
   */
  async createSale(dto: CreateVoucherSaleDto, actor: SaleActor): Promise<{ id: number }> {
    const quantity = dto.quantity ?? 1;
    if (quantity < 1) throw new BadRequestException('Jumlah minimal 1.');

    let username = dto.username?.trim() || null;
    let profileName = dto.profile_name?.trim() ?? '';
    let profileType: 'hotspot' | 'ppp' = dto.profile_type ?? 'hotspot';
    let costPrice = Number(dto.cost_price ?? 0);
    let sellPrice = Number(dto.sell_price ?? 0);
    let voucherOwner: number | null = null;

    if (dto.voucher_id) {
      const voucher = await this.db.queryOne<RowDataPacket>(
        // Kolom harga di radius_vouchers bernama `price` (harga jual voucher).
        'SELECT id, username, profile_name, profile_type, owner_id, price FROM radius_vouchers WHERE id = ?',
        [dto.voucher_id],
      );
      if (!voucher) throw new NotFoundException(`Voucher #${dto.voucher_id} tidak ditemukan.`);

      const sold = await this.db.queryOne<{ total: number }>(
        'SELECT COUNT(*) AS total FROM voucher_sales WHERE voucher_id = ? AND voided_at IS NULL',
        [dto.voucher_id],
      );
      if (Number(sold?.total ?? 0) > 0) {
        throw new ConflictException(
          'Voucher ini sudah tercatat terjual. Batalkan catatan yang lama bila penjualannya dibatalkan.',
        );
      }

      username = voucher.username ? String(voucher.username) : username;
      profileName = String(voucher.profile_name ?? profileName);
      profileType = (voucher.profile_type ?? profileType) as 'hotspot' | 'ppp';
      voucherOwner = voucher.owner_id === null ? null : Number(voucher.owner_id);
      // Harga jual voucher menjadi nilai awal; pemanggil boleh menimpanya
      // (mis. harga warung). Modal tetap dari input — modal per voucher tidak
      // disimpan di radius_vouchers.
      if ((dto.sell_price === undefined || dto.sell_price === null) && voucher.price !== null) {
        sellPrice = Number(voucher.price);
      }
    }

    if (profileName === '') {
      throw new BadRequestException('Nama profil wajib diisi (atau pilih voucher yang dijual).');
    }

    const ownerId = await this.resolveOwner(actor, dto.owner_id ?? voucherOwner ?? undefined);

    const id = await this.repository.create({
      voucher_id: dto.voucher_id ?? null,
      username,
      profile_name: profileName,
      profile_type: profileType,
      quantity,
      cost_price: costPrice,
      sell_price: sellPrice,
      owner_id: ownerId,
      recorded_by: actor.userId,
      buyer_name: dto.buyer_name?.trim() || null,
      method: dto.method ?? 'cash',
      note: dto.note?.trim() || null,
    });

    await this.audit(actor, 'VOUCHER_SALE_CREATED', {
      id,
      voucher_id: dto.voucher_id ?? null,
      quantity,
      cost_price: costPrice,
      sell_price: sellPrice,
      owner_id: ownerId,
    });
    return { id };
  }

  async listSales(filter: SaleFilter, scope: RequestScope) {
    const result = await this.repository.list(filter, scope);
    return result;
  }

  /**
   * Batalkan penjualan. Tidak menghapus baris: jejak uang harus tetap ada
   * supaya selisih laporan bisa dijelaskan di kemudian hari.
   */
  async voidSale(id: number, dto: VoidSaleDto, actor: SaleActor): Promise<{ ok: true }> {
    const sale = await this.repository.findById(id);
    if (!sale) throw new NotFoundException(`Penjualan #${id} tidak ditemukan.`);
    if (sale.voided_at) throw new ConflictException('Penjualan ini sudah dibatalkan.');

    // Non-admin hanya boleh membatalkan catatannya sendiri.
    if (actor.role !== 'admin') {
      const owns = Number(sale.recorded_by) === actor.userId || Number(sale.owner_id) === actor.userId;
      if (!owns) {
        throw new NotFoundException(`Penjualan #${id} tidak ditemukan.`);
      }
    }

    const reason = dto.reason?.trim() || 'Dibatalkan operator';
    await this.repository.void(id, actor.userId, reason);
    await this.audit(actor, 'VOUCHER_SALE_VOIDED', { id, reason });
    return { ok: true };
  }

  /** Voucher yang belum tercatat terjual, untuk pilihan di form penjualan. */
  async unsoldVouchers(ownerId?: number, limit = 100): Promise<RowDataPacket[]> {
    return this.repository.unsoldVouchers(ownerId, limit);
  }

  /** Ringkasan pendapatan periode; dipakai Laporan dan Dashboard. */
  async revenue(from: string | undefined, to: string | undefined, scope: RequestScope) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && !dateOnly.test(from)) || (to && !dateOnly.test(to))) {
      throw new BadRequestException('Tanggal harus format YYYY-MM-DD');
    }
    const summary = await this.repository.revenue(from, to, scope);
    return {
      ...summary,
      // Label cakupan dipakai UI supaya angka tidak disalahartikan.
      scope: this.scopeLabel(scope),
    };
  }

  /**
   * Pendapatan hari ini + bulan berjalan, dipakai kartu dashboard.
   *
   * Tanggal "hari ini" diambil dari database (CURDATE), bukan dari jam Node:
   * server bisa berjalan di zona waktu berbeda (UTC vs WIB), dan selisih itu
   * membuat penjualan pagi hari hilang dari kartu hari ini.
   */
  async revenueSnapshot(scope: RequestScope, todayInput?: string) {
    const today = todayInput ?? (await this.todayFromDatabase());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [day, month] = await Promise.all([
      this.repository.revenue(today, today, scope),
      this.repository.revenue(monthStart, today, scope),
    ]);
    return {
      today,
      month_start: monthStart,
      today_revenue: day.total_income,
      today_payments: day.payments_income,
      today_vouchers: day.voucher_income,
      today_voucher_cost: day.voucher_cost,
      today_margin: day.voucher_margin,
      month_revenue: month.total_income,
      month_payments: month.payments_income,
      month_vouchers: month.voucher_income,
      month_voucher_cost: month.voucher_cost,
      month_margin: month.voucher_margin,
      scope: this.scopeLabel(scope),
    };
  }

  /** Tanggal menurut database, format YYYY-MM-DD. */
  private async todayFromDatabase(): Promise<string> {
    const row = await this.db
      .queryOne<{ today: string }>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today")
      .catch(() => null);
    return row?.today ? String(row.today) : new Date().toISOString().slice(0, 10);
  }

  private scopeLabel(scope: RequestScope): 'all' | 'own' {
    return scope.role === 'admin' ? 'all' : 'own';
  }

  private async audit(actor: SaleActor, action: string, details: Record<string, unknown>) {
    await this.db
      .execute('INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)', [
        actor.userId,
        action,
        JSON.stringify(details),
        actor.ip,
      ])
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit ${action} gagal ditulis: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}

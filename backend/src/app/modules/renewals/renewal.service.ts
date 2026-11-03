import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { RequestScope } from '../auth/request-scope';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceActor } from '../invoices/invoices.repository';
import { PaymentsService } from '../payments/payments.service';
import { ReceivablesRepository } from '../receivables/receivables.repository';
import { SettingsService } from '../settings/settings.service';
import { PaymentActor } from '../payments/payments.repository';
import { PaymentMethod } from '../payments/dto/payment.dto';
import { RenewCustomerDto, RenewalPreviewQueryDto } from './dto/renewal.dto';
import {
  RenewalAccount,
  RenewalCustomer,
  RenewalError,
  RenewalProfile,
  RenewalRecord,
  RenewalRepository,
} from './renewal.repository';

const UNIT_SECONDS: Record<RenewalProfile['validity_unit'], number> = {
  minute: 60,
  hour: 3600,
  day: 86_400,
  month: 30 * 86_400,
};

/** Detik masa aktif dari profil; 0 = paket tanpa masa aktif. */
export function unitToSeconds(value: number, unit: RenewalProfile['validity_unit']): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const factor = UNIT_SECONDS[unit] ?? 0;
  return Math.round(value * factor);
}

/**
 * Periode perpanjangan: mulai dari masa aktif terakhir bila masih berjalan
 * (perpanjangan di awal tidak menghanguskan sisa waktu), atau dari sekarang
 * bila sudah lewat/tidak ada.
 */
export function renewalPeriod(
  prevExpiresAt: Date | null,
  now: Date,
  seconds: number,
): { start: Date; end: Date } {
  const start = prevExpiresAt && prevExpiresAt.getTime() > now.getTime() ? prevExpiresAt : now;
  return { start, end: new Date(start.getTime() + seconds * 1000) };
}

/** Harga jual: promo bila sedang berlaku, lalu pajak profil. */
export function renewalAmount(profile: Pick<RenewalProfile, 'sell_price' | 'promo_price' | 'tax_percent'>): {
  base: number;
  tax: number;
  total: number;
} {
  const base = profile.promo_price > 0 ? profile.promo_price : profile.sell_price;
  const tax = Math.round(base * (profile.tax_percent / 100) * 100) / 100;
  return { base, tax, total: Math.round((base + tax) * 100) / 100 };
}

const dateOnly = (date: Date): string => {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

const rupiah = (value: number) => `Rp ${value.toLocaleString('id-ID')}`;

interface RenewalContext {
  customer: RenewalCustomer;
  account: RenewalAccount;
  profile: RenewalProfile;
  seconds: number;
  start: Date;
  end: Date;
  money: { base: number; tax: number; total: number };
}

@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: RenewalRepository,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly receivables: ReceivablesRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Membaca pelanggan + akun + paket dengan cakupan pemanggil (fail-closed). */
  private async context(
    customerId: number,
    query: RenewalPreviewQueryDto,
    scope: RequestScope,
  ): Promise<RenewalContext> {
    const customer = await this.repository.customer(customerId, scope);
    if (!customer) {
      // Pesan sama untuk "tidak ada" dan "milik owner lain": jangan bocorkan
      // keberadaan pelanggan di luar cakupan.
      throw new NotFoundException('Pelanggan tidak ditemukan dalam cakupan Anda.');
    }

    const account = await this.repository.account(customerId, query.username?.trim() || undefined);
    if (!account) {
      throw new NotFoundException('Pelanggan ini belum punya akun layanan Hotspot/PPPoE.');
    }

    const profileId = query.profile_id ?? account.profile_id;
    const profile = await this.repository.profile(account.profile_type, profileId);
    if (!profile) {
      throw new BadRequestException('Paket perpanjangan tidak ditemukan untuk jenis layanan ini.');
    }
    if (Number(profile.is_active) !== 1) {
      throw new BadRequestException(`Paket "${profile.name}" sedang tidak aktif.`);
    }

    const seconds = unitToSeconds(profile.validity_value, profile.validity_unit);
    if (seconds <= 0) {
      throw new BadRequestException(
        `Paket "${profile.name}" tidak punya masa aktif (validity 0), jadi tidak bisa diperpanjang.`,
      );
    }

    const { start, end } = renewalPeriod(account.expires_at, new Date(), seconds);
    return { customer, account, profile, seconds, start, end, money: renewalAmount(profile) };
  }

  async preview(customerId: number, query: RenewalPreviewQueryDto, scope: RequestScope) {
    const ctx = await this.context(customerId, query, scope);
    return {
      customer: {
        id: ctx.customer.id,
        name: ctx.customer.name,
        internet_no: ctx.customer.internet_no,
        status: ctx.customer.status,
      },
      account: {
        username: ctx.account.username,
        profile_type: ctx.account.profile_type,
        status: ctx.account.status,
        expires_at: ctx.account.expires_at,
        current_profile: ctx.account.profile_name,
      },
      profile: {
        id: ctx.profile.id,
        name: ctx.profile.name,
        validity_value: ctx.profile.validity_value,
        validity_unit: ctx.profile.validity_unit,
      },
      period: {
        start: ctx.start.toISOString(),
        end: ctx.end.toISOString(),
        start_date: dateOnly(ctx.start),
        end_date: dateOnly(ctx.end),
        days: Math.round(ctx.seconds / 86_400),
      },
      amount: ctx.money,
    };
  }

  /**
   * Perpanjangan = tagihan + pembayaran + masa aktif, memakai mekanisme yang
   * sudah ada. Urutannya: tagihan (kunci anti-ganda periode) → pembayaran →
   * masa aktif + RADIUS. Bila langkah terakhir gagal, tagihan & pembayaran
   * di-void supaya uang tidak tercatat untuk layanan yang tidak diperpanjang.
   */
  async renew(
    customerId: number,
    dto: RenewCustomerDto,
    scope: RequestScope,
    actor: InvoiceActor & PaymentActor & { role?: string },
  ) {
    // Klik ganda / kirim ulang: kunci yang sama mengembalikan hasil yang sama
    // tanpa membuat tagihan, pembayaran, atau perpanjangan baru.
    const replay = await this.repository.byKey(dto.idempotency_key);
    if (replay) {
      return {
        renewal: replay,
        invoice: null,
        account: { id: replay.account_id, username: replay.username, expires_at: replay.period_end },
        replayed: true,
      };
    }

    const ctx = await this.context(customerId, dto, scope);

    if (dto.payment_mode === 'credit') {
      return this.renewOnCredit(ctx, dto, scope, actor);
    }
    if (!dto.method) {
      throw new BadRequestException('Metode pembayaran wajib dipilih untuk perpanjangan tunai.');
    }

    if (ctx.customer.status === 'suspend' || ctx.customer.status === 'disable') {
      throw new ConflictException(
        `Pelanggan berstatus "${ctx.customer.status}" tidak dapat diperpanjang. ` +
          'Ubah status pelanggan terlebih dahulu sesuai kebijakan operasional.',
      );
    }

    const amount = dto.amount ?? ctx.money.total;
    if (amount > ctx.money.total) {
      throw new BadRequestException(
        `Nominal melebihi harga paket + pajak (${rupiah(ctx.money.total)}).`,
      );
    }

    const periodStartDate = dateOnly(ctx.start);
    const periodEndDate = dateOnly(ctx.end);

    const existing = await this.repository.invoiceForPeriod(
      customerId,
      ctx.account.username,
      periodStartDate,
    );
    if (existing) {
      throw new ConflictException(
        `Periode ${periodStartDate} sudah ditagih lewat ${existing.invoice_number}. ` +
          'Perpanjangan ganda tidak dibuat.',
      );
    }

    const invoice = await this.invoices.create(
      {
        customer_id: customerId,
        username: ctx.account.username,
        amount,
        due_date: dto.paid_at ?? dateOnly(new Date()),
        period_start: periodStartDate,
        period_end: periodEndDate,
        description:
          `Perpanjangan ${ctx.account.profile_type === 'ppp' ? 'PPPoE' : 'Hotspot'} ` +
          `${ctx.profile.name} ${periodStartDate} s.d. ${periodEndDate}`,
      },
      actor,
    );

    const paid = await this.payments.create(
      invoice.id,
      {
        amount,
        method: dto.method as unknown as PaymentMethod,
        reference: dto.reference,
        note: dto.note ?? `Perpanjangan layanan ${ctx.account.username}`,
        paid_at: dto.paid_at,
        idempotency_key: dto.idempotency_key,
      },
      actor,
    );

    try {
      const renewal = await this.repository.apply({
        customerId,
        accountId: ctx.account.id,
        username: ctx.account.username,
        password: ctx.account.password,
        profileType: ctx.account.profile_type,
        profileId: ctx.profile.id,
        profileName: ctx.profile.name,
        groupname: ctx.profile.radius_group ?? ctx.profile.name,
        expectedExpiresAt: ctx.account.expires_at,
        newExpiresAt: ctx.end,
        periodStart: ctx.start,
        durationSeconds: ctx.seconds,
        amount,
        invoiceId: invoice.id,
        paymentId: paid.payment.id,
        actorId: actor.id,
        actorName: actor.name,
        note: dto.note?.trim() || null,
        idempotencyKey: dto.idempotency_key,
      });

      await this.audit(actor, 'customer.renew', {
        customer_id: customerId,
        internet_no: ctx.customer.internet_no,
        username: ctx.account.username,
        profile_type: ctx.account.profile_type,
        profile_id: ctx.profile.id,
        profile_name: ctx.profile.name,
        prev_expires_at: ctx.account.expires_at,
        new_expires_at: ctx.end,
        amount,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        payment_id: paid.payment.id,
        renewal_id: renewal.id,
      });

      return {
        replayed: false,
        renewal,
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          amount: invoice.amount,
          status: 'paid',
        },
        account: {
          id: ctx.account.id,
          username: ctx.account.username,
          profile_type: ctx.account.profile_type,
          profile_name: ctx.profile.name,
          expires_at: ctx.end,
          status: 'active',
        },
      };
    } catch (error) {
      // Kompensasi: jangan tinggalkan tagihan lunas untuk layanan yang gagal
      // diperpanjang. Void memakai mekanisme yang sudah ada (tidak menghapus).
      const reason = `Perpanjangan ${ctx.account.username} gagal diterapkan`;
      await this.payments
        .void(paid.payment.id, { reason }, actor)
        .catch((e: unknown) =>
          this.logger.error(`Void pembayaran ${paid.payment.id} gagal: ${String(e)}`),
        );
      await this.invoices
        .void(invoice.id, `${reason}; tagihan dibatalkan otomatis`, actor)
        .catch((e: unknown) => this.logger.error(`Void tagihan ${invoice.id} gagal: ${String(e)}`));
      throw this.mapError(error);
    }
  }


  /** Batas hari jatuh tempo piutang dari pengaturan sistem (bawaan 30). */
  private async receivableMaxDays(): Promise<number> {
    const raw = await this.settings.rawValue('receivable_max_days').catch(() => '30');
    const days = Number(raw);
    return Number.isFinite(days) && days > 0 ? Math.min(Math.trunc(days), 365) : 30;
  }

  /**
   * Perpanjangan dengan piutang (deferred payment).
   *
   * Tidak ada pembayaran palsu: tagihan dibuat `unpaid` dengan periode, masa
   * aktif langsung diperpanjang, dan saldo piutang dihitung dari sisa tagihan.
   * Seluruh langkah (cek limit → tagihan → masa aktif) berada dalam SATU
   * transaksi dengan baris pelanggan dikunci, sehingga dua permintaan
   * bersamaan tidak bisa melewati batas piutang.
   */
  private async renewOnCredit(
    ctx: RenewalContext,
    dto: RenewCustomerDto,
    scope: RequestScope,
    actor: InvoiceActor & PaymentActor & { role?: string },
  ) {
    // Hanya admin. Diperiksa di backend, bukan hanya disembunyikan di UI.
    if (actor.role !== 'admin') {
      throw new ForbiddenException(
        'Perpanjangan dengan piutang hanya dapat disetujui oleh admin.',
      );
    }

    if (ctx.customer.status === 'suspend' || ctx.customer.status === 'disable') {
      throw new ConflictException(
        `Pelanggan berstatus "${ctx.customer.status}" tidak dapat diperpanjang.`,
      );
    }

    const amount = dto.amount ?? ctx.money.total;
    if (amount > ctx.money.total) {
      throw new BadRequestException(
        `Nominal melebihi harga paket + pajak (${rupiah(ctx.money.total)}).`,
      );
    }

    const maxDays = await this.receivableMaxDays();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDue = new Date(today.getTime() + maxDays * 86_400_000);
    const dueDate = dto.due_date ? new Date(`${dto.due_date}T00:00:00`) : maxDue;
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Tanggal jatuh tempo tidak valid.');
    }
    if (dueDate.getTime() < today.getTime()) {
      throw new BadRequestException('Jatuh tempo tidak boleh sebelum hari ini.');
    }
    if (dueDate.getTime() > maxDue.getTime()) {
      throw new BadRequestException(
        `Jatuh tempo piutang maksimal ${maxDays} hari sesuai kebijakan sistem.`,
      );
    }

    const periodStartDate = dateOnly(ctx.start);
    const periodEndDate = dateOnly(ctx.end);

    const existing = await this.repository.invoiceForPeriod(
      ctx.customer.id,
      ctx.account.username,
      periodStartDate,
    );
    if (existing) {
      throw new ConflictException(
        `Periode ${periodStartDate} sudah ditagih lewat ${existing.invoice_number}.`,
      );
    }

    const result = await this.db.withTransaction(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT id, credit_limit FROM customers WHERE id = ? FOR UPDATE',
        [ctx.customer.id],
      );
      if (rows.length === 0) throw new NotFoundException('Pelanggan tidak ditemukan.');
      const limit = Number(rows[0].credit_limit ?? 0);
      if (limit <= 0) {
        throw new ForbiddenException(
          'Batas piutang pelanggan ini masih 0 (belum diatur). Tetapkan limit terlebih dahulu.',
        );
      }

      const receivable = await this.receivables.balance(ctx.customer.id, conn);
      const after = Math.round((receivable.outstanding + amount) * 100) / 100;
      if (after > limit) {
        throw new ConflictException(
          `Melebihi batas piutang: saldo ${rupiah(receivable.outstanding)} + ` +
            `${rupiah(amount)} = ${rupiah(after)}, batas ${rupiah(limit)}.`,
        );
      }

      const invoice = await this.invoices.create(
        {
          customer_id: ctx.customer.id,
          username: ctx.account.username,
          amount,
          status: 'unpaid' as never,
          due_date: dateOnly(dueDate),
          period_start: periodStartDate,
          period_end: periodEndDate,
          description:
            `Perpanjangan piutang ${ctx.account.profile_type === 'ppp' ? 'PPPoE' : 'Hotspot'} ` +
            `${ctx.profile.name} ${periodStartDate} s.d. ${periodEndDate}`,
        },
        actor,
        conn,
      );

      const renewal = await this.repository.apply(
        {
          customerId: ctx.customer.id,
          accountId: ctx.account.id,
          username: ctx.account.username,
          password: ctx.account.password,
          profileType: ctx.account.profile_type,
          profileId: ctx.profile.id,
          profileName: ctx.profile.name,
          groupname: ctx.profile.radius_group ?? ctx.profile.name,
          expectedExpiresAt: ctx.account.expires_at,
          newExpiresAt: ctx.end,
          periodStart: ctx.start,
          durationSeconds: ctx.seconds,
          amount,
          invoiceId: invoice.id,
          paymentId: null,
          actorId: actor.id,
          actorName: actor.name,
          note: dto.note?.trim() || 'Perpanjangan dengan piutang',
          idempotencyKey: dto.idempotency_key,
        },
        conn,
      );

      return { invoice, renewal, before: receivable.outstanding, limit, after };
    });

    await this.audit(actor, 'customer.renew_credit', {
      customer_id: ctx.customer.id,
      internet_no: ctx.customer.internet_no,
      username: ctx.account.username,
      profile_type: ctx.account.profile_type,
      profile_name: ctx.profile.name,
      invoice_id: result.invoice.id,
      invoice_number: result.invoice.invoice_number,
      amount,
      due_date: dateOnly(dueDate),
      receivable_before: result.before,
      receivable_after: result.after,
      credit_limit: result.limit,
      renewal_id: result.renewal.id,
      approved_by: actor.id,
    });

    return {
      replayed: false,
      payment_mode: 'credit',
      renewal: result.renewal,
      invoice: {
        id: result.invoice.id,
        invoice_number: result.invoice.invoice_number,
        amount: result.invoice.amount,
        status: 'unpaid',
        due_date: dateOnly(dueDate),
      },
      receivable: {
        before: result.before,
        after: result.after,
        limit: result.limit,
        remaining: Math.round(Math.max(result.limit - result.after, 0) * 100) / 100,
      },
      account: {
        id: ctx.account.id,
        username: ctx.account.username,
        profile_type: ctx.account.profile_type,
        profile_name: ctx.profile.name,
        expires_at: ctx.end,
        status: 'active',
      },
    };
  }

  async history(customerId: number, scope: RequestScope): Promise<RenewalRecord[]> {
    const customer = await this.repository.customer(customerId, scope);
    if (!customer) {
      throw new NotFoundException('Pelanggan tidak ditemukan dalam cakupan Anda.');
    }
    return this.repository.history(customerId);
  }

  private mapError(error: unknown): unknown {
    if (error instanceof RenewalError) {
      switch (error.code) {
        case 'EXPIRY_CHANGED':
          return new ConflictException(error.message);
        case 'ACCOUNT_MISSING':
          return new NotFoundException(error.message);
        default:
          return new BadRequestException(error.message);
      }
    }
    const code = (error as { code?: string })?.code;
    if (code === 'ER_DUP_ENTRY') {
      return new ConflictException(
        'Periode ini baru saja ditagih oleh permintaan lain. Muat ulang lalu periksa daftar tagihan.',
      );
    }
    return error;
  }

  private async audit(
    actor: { id: number; ip: string },
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.db
      .execute('INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)', [
        actor.id,
        action,
        JSON.stringify(details),
        actor.ip,
      ])
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit ${action} gagal: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
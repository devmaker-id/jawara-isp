import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PaymentError, PaymentsRepository } from '../src/app/modules/payments/payments.repository';
import { PaymentsService } from '../src/app/modules/payments/payments.service';

const actor = { id: 1, email: 'admin@uji.test', name: 'Admin Uji', ip: '127.0.0.1' };

function makeService(overrides: Record<string, unknown> = {}) {
  const base = {
    listByInvoice: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      payment: { id: 1, idempotency_key: 'kunci-uji-1' },
      invoice: { id: 1, status: 'partial', paid_date: null },
      created: true,
    }),
    void: vi.fn().mockResolvedValue({
      payment: { id: 1 },
      invoice: { id: 1, status: 'unpaid', paid_date: null },
      created: false,
    }),
    ...overrides,
  };
  return {
    service: new PaymentsService(base as unknown as PaymentsRepository),
    raw: base,
  };
}

const future = (): string => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

describe('PaymentsService', () => {
  it('menerjemahkan OVERPAY menjadi 400 dengan nilai sisa', async () => {
    const { service } = makeService({
      create: vi
        .fn()
        .mockRejectedValue(new PaymentError('OVERPAY', 'melebihi sisa tagihan', 15000)),
    });
    const error = await service.create(1, { amount: 20000 }, actor).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toMatch(/Rp 15\.000/);
  });

  it('menerjemahkan ALREADY_PAID menjadi 409', async () => {
    const { service } = makeService({
      create: vi.fn().mockRejectedValue(new PaymentError('ALREADY_PAID', 'lunas')),
    });
    await expect(service.create(1, { amount: 1000 }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('kunci idempoten yang barisnya sudah di-void → 409, bukan tagihan kedua', async () => {
    const { service } = makeService({
      create: vi.fn().mockRejectedValue(
        new PaymentError('IDEMPOTENT_VOIDED', 'Pembayaran dengan kunci ini sudah dibatalkan'),
      ),
    });
    const error = await service
      .create(1, { amount: 1000, idempotency_key: 'kunci-uji-1' }, actor)
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(/sudah dibatalkan/);
  });

  it('menolak tanggal pembayaran di masa depan sebelum menyentuh repository', async () => {
    const { service, raw } = makeService();
    await expect(
      service.create(1, { amount: 1000, paid_at: future() }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(raw.create).not.toHaveBeenCalled();
  });

  it('void tanpa alasan (spasi saja) ditolak 400 tanpa menyentuh repository', async () => {
    const { service, raw } = makeService();
    await expect(service.void(1, { reason: '   ' }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(raw.void).not.toHaveBeenCalled();
  });

  it('void ganda → 409', async () => {
    const { service } = makeService({
      void: vi.fn().mockRejectedValue(new PaymentError('ALREADY_VOIDED', 'sudah dibatalkan')),
    });
    await expect(service.void(1, { reason: 'salah input' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('pembayaran untuk tagihan yang tidak ada → 404', async () => {
    const { service } = makeService({
      create: vi.fn().mockRejectedValue(new PaymentError('INVOICE_NOT_FOUND', 'tidak ada')),
    });
    await expect(service.create(99, { amount: 1000 }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tabel payments belum ada → 503 dengan pesan migrasi', async () => {
    const { service } = makeService({
      listByInvoice: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' })),
    });
    const error = await service.listByInvoice(1).catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).toMatch(/001_payments\.sql/);
  });

  it('galat koneksi database → 503', async () => {
    const { service } = makeService({
      listByInvoice: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })),
    });
    await expect(service.listByInvoice(1)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

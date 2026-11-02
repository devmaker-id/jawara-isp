import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InvoicesService } from '../src/app/modules/invoices/invoices.service';
import { InvoiceError } from '../src/app/modules/invoices/invoices.repository';
import { InvoiceStatus } from '../src/app/modules/invoices/dto/invoice.dto';
import type { InvoicesRepository } from '../src/app/modules/invoices/invoices.repository';
import type { Invoice } from '../src/app/modules/invoices/invoices.repository';
import type { FinanceEventsRepository } from '../src/app/modules/finance/finance-events.repository';

const actor = { id: 1, email: 'admin@uji.test', name: 'Admin Uji', ip: '127.0.0.1' };

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 1,
  invoice_number: 'INV-2026-0001',
  customer_id: 3,
  username: null,
  customer_name: 'Pelanggan Uji',
  amount: 49500.5,
  status: InvoiceStatus.UNPAID,
  due_date: '2026-02-01',
  period_start: null,
  period_end: null,
  paid_date: null,
  description: '',
  voided_at: null,
  void_reason: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

function makeService(repo: Partial<InvoicesRepository> = {}, events?: Partial<FinanceEventsRepository>) {
  const base = {
    findAll: vi.fn().mockResolvedValue([invoice()]),
    findById: vi.fn().mockResolvedValue(invoice()),
    findByCustomer: vi.fn().mockResolvedValue([invoice()]),
    summary: vi.fn().mockResolvedValue({ total: 49500.5, paid: 0, unpaid: 1, overdue: 0 }),
    create: vi.fn().mockResolvedValue(invoice()),
    update: vi.fn().mockResolvedValue(invoice()),
    void: vi.fn().mockResolvedValue(invoice({ status: InvoiceStatus.VOID })),
    remove: vi
      .fn()
      .mockRejectedValue(new InvoiceError('DELETE_FORBIDDEN', 'Tagihan tidak dapat dihapus permanen')),
    ...repo,
  };
  const financeEvents = {
    list: vi.fn().mockResolvedValue([]),
    ...events,
  };
  return {
    service: new InvoicesService(
      base as unknown as InvoicesRepository,
      financeEvents as unknown as FinanceEventsRepository,
    ),
    raw: base,
    events: financeEvents,
  };
}

describe('InvoicesService', () => {
  it('findOne melempar 404 bila tagihan tidak ada', async () => {
    const { service } = makeService({ findById: vi.fn().mockResolvedValue(null) });
    await expect(service.findOne(5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove ditolak 409: hapus permanen diganti void', async () => {
    const { service, raw } = makeService();
    await expect(service.remove()).rejects.toBeInstanceOf(ConflictException);
    expect(raw.remove).toHaveBeenCalled();
  });

  it('menerjemahkan NOT_FOUND repository menjadi 404', async () => {
    const { service } = makeService({
      findById: vi.fn().mockRejectedValue(new InvoiceError('NOT_FOUND', 'Tagihan tidak ditemukan')),
    });
    await expect(service.findOne(9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('menerjemahkan galat koneksi database menjadi 503', async () => {
    const { service } = makeService({
      findAll: vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })),
    });
    await expect(service.findAll()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('menerjemahkan ER_DUP_ENTRY (nomor tagihan) menjadi 409', async () => {
    const { service } = makeService({
      create: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })),
    });
    await expect(
      service.create({ customer_id: 3, amount: 1000, due_date: '2026-03-01' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('menerjemahkan tagihan ganda (uq_invoices_period) menjadi 409 dengan pesan periode', async () => {
    const { service } = makeService({
      create: vi.fn().mockRejectedValue(
        Object.assign(
          new Error("Duplicate entry '3-budi-ppp-2026-03-01' for key 'uq_invoices_period'"),
          { code: 'ER_DUP_ENTRY' },
        ),
      ),
    });

    const error = await service
      .create(
        {
          customer_id: 3,
          username: 'budi-ppp',
          amount: 1000,
          due_date: '2026-03-01',
          period_start: '2026-03-01',
          period_end: '2026-03-31',
        },
        actor,
      )
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toMatch(/akun dan periode ini sudah ada/);
  });

  it('menerjemahkan periode tidak valid menjadi 400', async () => {
    const { service } = makeService({
      create: vi
        .fn()
        .mockRejectedValue(new InvoiceError('INVALID_PERIOD', 'periode awal dan periode akhir harus diisi bersama')),
    });
    await expect(
      service.create({ customer_id: 3, amount: 1000, due_date: '2026-03-01' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('menerjemahkan void tagihan berpembayaran menjadi 409', async () => {
    const { service } = makeService({
      void: vi.fn().mockRejectedValue(
        new InvoiceError('INVOICE_HAS_PAYMENTS', 'Tagihan masih punya pembayaran sah'),
      ),
    });
    await expect(service.void(1, 'ganti tagihan', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('menerjemahkan void ganda menjadi 409', async () => {
    const { service } = makeService({
      void: vi.fn().mockRejectedValue(new InvoiceError('INVOICE_ALREADY_VOID', 'sudah dibatalkan')),
    });
    await expect(service.void(1, 'ulang', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('menerjemahkan pelanggan tidak ada menjadi 404', async () => {
    const { service } = makeService({
      create: vi
        .fn()
        .mockRejectedValue(new InvoiceError('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan')),
    });
    await expect(
      service.create({ customer_id: 999, amount: 1000, due_date: '2026-03-01' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('menerjemahkan FIELD_NOT_LOCKED… (tagihan lunas) menjadi 409', async () => {
    const { service } = makeService({
      update: vi.fn().mockRejectedValue(new InvoiceError('PAID_INVOICE_LOCKED', 'lunas')),
    });
    await expect(service.update(1, { amount: 10 }, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  describe('events', () => {
    it('mengembalikan riwayat finance_events setelah cek keberadaan tagihan', async () => {
      const list = vi.fn().mockResolvedValue([
        { id: 2, entity_type: 'invoice', entity_id: 1, action: 'INVOICE_VOIDED' },
      ]);
      const { service, raw } = makeService({}, { list });

      const rows = await service.events(1);

      expect(raw.findById).toHaveBeenCalledWith(1, expect.anything());
      expect(list).toHaveBeenCalledWith('invoice', 1);
      expect(rows).toHaveLength(1);
    });

    it('tagihan tidak ada → 404 dan event tidak dibaca', async () => {
      const list = vi.fn();
      const { service } = makeService({ findById: vi.fn().mockResolvedValue(null) }, { list });

      await expect(service.events(99)).rejects.toBeInstanceOf(NotFoundException);
      expect(list).not.toHaveBeenCalled();
    });
  });
});
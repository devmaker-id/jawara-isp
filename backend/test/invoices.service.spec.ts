import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InvoicesService } from '../src/app/modules/invoices/invoices.service';
import { InvoiceError } from '../src/app/modules/invoices/invoices.repository';
import { InvoiceStatus } from '../src/app/modules/invoices/dto/invoice.dto';
import type { InvoicesRepository } from '../src/app/modules/invoices/invoices.repository';
import type { Invoice } from '../src/app/modules/invoices/invoices.repository';

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 1,
  invoice_number: 'INV-2026-0001',
  customer_id: 3,
  customer_name: 'Pelanggan Uji',
  amount: 49500.5,
  status: InvoiceStatus.UNPAID,
  due_date: '2026-02-01',
  paid_date: null,
  description: '',
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

function makeService(repo: Partial<InvoicesRepository> = {}) {
  const base = {
    findAll: vi.fn().mockResolvedValue([invoice()]),
    findById: vi.fn().mockResolvedValue(invoice()),
    findByCustomer: vi.fn().mockResolvedValue([invoice()]),
    summary: vi.fn().mockResolvedValue({ total: 49500.5, paid: 0, unpaid: 1, overdue: 0 }),
    create: vi.fn().mockResolvedValue(invoice()),
    update: vi.fn().mockResolvedValue(invoice()),
    remove: vi.fn().mockResolvedValue(true),
    pay: vi.fn().mockResolvedValue(invoice({ status: InvoiceStatus.PAID, paid_date: '2026-02-01' })),
    ...repo,
  };
  return { service: new InvoicesService(base as unknown as InvoicesRepository), raw: base };
}

describe('InvoicesService', () => {
  it('findOne melempar 404 bila tagihan tidak ada', async () => {
    const { service } = makeService({ findById: vi.fn().mockResolvedValue(null) });
    await expect(service.findOne(5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove melempar 404 bila tidak ada baris terhapus', async () => {
    const { service } = makeService({ remove: vi.fn().mockResolvedValue(false) });
    await expect(service.remove(5)).rejects.toBeInstanceOf(NotFoundException);
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
      service.create({ customer_id: 3, amount: 1000, due_date: '2026-03-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('menerjemahkan pelanggan tidak ada menjadi 404', async () => {
    const { service } = makeService({
      create: vi
        .fn()
        .mockRejectedValue(new InvoiceError('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan')),
    });
    await expect(
      service.create({ customer_id: 999, amount: 1000, due_date: '2026-03-01' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('menerjemahkan FIELD_NOT_LOCKED… (tagihan lunas) menjadi 409', async () => {
    const { service } = makeService({
      update: vi.fn().mockRejectedValue(new InvoiceError('PAID_INVOICE_LOCKED', 'lunas')),
    });
    await expect(service.update(1, { amount: 10 })).rejects.toBeInstanceOf(ConflictException);
  });
});
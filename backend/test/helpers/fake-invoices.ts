import { InvoicesRepository, InvoiceError, Invoice } from '../../src/app/modules/invoices/invoices.repository';
import { InvoiceStatus } from '../../src/app/modules/invoices/dto/invoice.dto';
import type { CreateInvoiceDto, PayInvoiceDto, UpdateInvoiceDto } from '../../src/app/modules/invoices/dto/invoice.dto';

// Repository in-memory untuk e2e: tidak menyentuh tabel invoices sebenarnya.
// Aturan domain (overpay, parsial, sudah lunas) ditiru agar otorisasi dan
// validasi diuji lewat HTTP tanpa menulis ke database produksi.
export interface FakeInvoices {
  repo: InvoicesRepository;
  items: Map<number, Invoice>;
  customers: Map<number, string>;
}

export function createFakeInvoices(): FakeInvoices {
  const items = new Map<number, Invoice>();
  const customers = new Map<number, string>([
    [1, 'Pelanggan Uji Satu'],
    [2, 'Pelanggan Uji Dua'],
  ]);
  let nextId = 1;

  const statusOf = (inv: Invoice): Invoice['status'] =>
    inv.status === InvoiceStatus.UNPAID && inv.due_date < new Date().toISOString().slice(0, 10)
      ? InvoiceStatus.OVERDUE
      : inv.status;

  const withStatus = (inv: Invoice): Invoice => ({ ...inv, status: statusOf(inv) });

  const need = (id: number): Invoice => {
    const inv = items.get(id);
    if (!inv) throw new InvoiceError('NOT_FOUND', `Tagihan dengan ID ${id} tidak ditemukan`);
    return inv;
  };

  const repo = {
    findAll: async () => [...items.values()].sort((a, b) => b.id - a.id).map(withStatus),
    findById: async (id: number) => {
      const inv = items.get(id);
      return inv ? withStatus(inv) : null;
    },
    findByCustomer: async (customerId: number) =>
      [...items.values()].filter((i) => i.customer_id === customerId).map(withStatus),
    summary: async () => {
      const list = [...items.values()].map(withStatus);
      return {
        total: list.reduce((sum, i) => sum + i.amount, 0),
        paid: list.filter((i) => i.status === InvoiceStatus.PAID).length,
        unpaid: list.filter((i) => i.status === InvoiceStatus.UNPAID).length,
        overdue: list.filter((i) => i.status === InvoiceStatus.OVERDUE).length,
      };
    },
    create: async (dto: CreateInvoiceDto) => {
      const name = customers.get(dto.customer_id);
      if (!name) {
        throw new InvoiceError('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan');
      }
      const created: Invoice = {
        id: nextId,
        invoice_number: `INV-2026-${String(nextId).padStart(4, '0')}`,
        customer_id: dto.customer_id,
        customer_name: name,
        amount: dto.amount,
        status: dto.status ?? InvoiceStatus.UNPAID,
        due_date: dto.due_date,
        paid_date: null,
        description: dto.description ?? '',
        created_at: new Date(),
      };
      nextId += 1;
      items.set(created.id, created);
      return withStatus(created);
    },
    update: async (id: number, dto: UpdateInvoiceDto) => {
      const current = need(id);
      if (current.status === InvoiceStatus.PAID && (dto.amount !== undefined || dto.due_date !== undefined)) {
        throw new InvoiceError('PAID_INVOICE_LOCKED', 'Tagihan sudah lunas');
      }
      if (dto.status === InvoiceStatus.PAID) {
        throw new InvoiceError('INVALID_STATUS', 'Gunakan endpoint pembayaran');
      }
      if (dto.customer_id !== undefined) {
        const name = customers.get(dto.customer_id);
        if (!name) throw new InvoiceError('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan');
        current.customer_name = name;
      }
      const updated: Invoice = {
        ...current,
        ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
      } as Invoice;
      items.set(id, updated);
      return withStatus(updated);
    },
    remove: async (id: number) => items.delete(id),
    pay: async (id: number, dto: PayInvoiceDto) => {
      const current = need(id);
      if (current.status === InvoiceStatus.PAID) {
        throw new InvoiceError('ALREADY_PAID', 'Tagihan sudah lunas', 0);
      }
      if (dto.amount > current.amount) {
        throw new InvoiceError('OVERPAY', 'melebihi sisa', current.amount);
      }
      if (dto.amount < current.amount) {
        throw new InvoiceError('PARTIAL_UNSUPPORTED', 'parsial tidak didukung', current.amount);
      }
      const paid: Invoice = {
        ...current,
        status: InvoiceStatus.PAID,
        paid_date: dto.paid_date ?? new Date().toISOString().slice(0, 10),
      };
      items.set(id, paid);
      return paid;
    },
  } as unknown as InvoicesRepository;

  return { repo, items, customers };
}
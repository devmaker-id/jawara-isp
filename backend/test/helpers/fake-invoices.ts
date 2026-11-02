import { InvoicesRepository, InvoiceError, Invoice } from '../../src/app/modules/invoices/invoices.repository';
import { InvoiceStatus } from '../../src/app/modules/invoices/dto/invoice.dto';
import type { CreateInvoiceDto, UpdateInvoiceDto } from '../../src/app/modules/invoices/dto/invoice.dto';
import type { InvoiceActor } from '../../src/app/modules/invoices/invoices.repository';
import { validateInvoicePeriod } from '../../src/app/modules/invoices/invoices.domain';

// Repository in-memory untuk e2e: tidak menyentuh tabel invoices sebenarnya.
// Aturan domain (overpay, parsial, sudah lunas, periode, void) ditiru agar
// otorisasi dan validasi diuji lewat HTTP tanpa menulis ke database produksi.
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
      // Tagihan void bukan uang: sama seperti query SQL di repository asli.
      const list = [...items.values()].map(withStatus).filter((i) => i.status !== InvoiceStatus.VOID);
      return {
        total: list.reduce((sum, i) => sum + i.amount, 0),
        paid: list.filter((i) => i.status === InvoiceStatus.PAID).length,
        unpaid: list.filter((i) => i.status === InvoiceStatus.UNPAID).length,
        overdue: list.filter((i) => i.status === InvoiceStatus.OVERDUE).length,
      };
    },
    create: async (dto: CreateInvoiceDto, _actor: InvoiceActor) => {
      const periodError = validateInvoicePeriod(dto.period_start, dto.period_end);
      if (periodError) throw new InvoiceError('INVALID_PERIOD', periodError);

      const name = customers.get(dto.customer_id);
      if (!name) {
        throw new InvoiceError('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan');
      }
      const created: Invoice = {
        id: nextId,
        invoice_number: `INV-2026-${String(nextId).padStart(4, '0')}`,
        customer_id: dto.customer_id,
        customer_name: name,
        username: dto.username?.trim() || null,
        amount: dto.amount,
        status: dto.status ?? InvoiceStatus.UNPAID,
        due_date: dto.due_date,
        period_start: dto.period_start ?? null,
        period_end: dto.period_end ?? null,
        paid_date: null,
        description: dto.description ?? '',
        voided_at: null,
        void_reason: null,
        created_at: new Date(),
      };
      nextId += 1;
      items.set(created.id, created);
      return withStatus(created);
    },
    update: async (id: number, dto: UpdateInvoiceDto, _actor: InvoiceActor) => {
      const current = need(id);
      if (current.status === InvoiceStatus.VOID) {
        throw new InvoiceError('INVOICE_ALREADY_VOID', 'Tagihan sudah dibatalkan (void)');
      }
      if (current.status === InvoiceStatus.PAID && (dto.amount !== undefined || dto.due_date !== undefined)) {
        throw new InvoiceError('PAID_INVOICE_LOCKED', 'Tagihan sudah lunas');
      }
      if (dto.status === InvoiceStatus.PAID || dto.status === InvoiceStatus.PARTIAL) {
        throw new InvoiceError('INVALID_STATUS', 'Gunakan endpoint pembayaran');
      }
      if (dto.status === InvoiceStatus.VOID) {
        throw new InvoiceError('INVALID_STATUS', 'Gunakan endpoint void');
      }
      const nextPeriodStart =
        dto.period_start !== undefined ? dto.period_start : current.period_start;
      const nextPeriodEnd = dto.period_end !== undefined ? dto.period_end : current.period_end;
      const periodError = validateInvoicePeriod(nextPeriodStart, nextPeriodEnd);
      if (periodError) throw new InvoiceError('INVALID_PERIOD', periodError);

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
    void: async (id: number, reason: string, _actor: InvoiceActor) => {
      const current = need(id);
      if (current.status === InvoiceStatus.VOID) {
        throw new InvoiceError(
          'INVOICE_ALREADY_VOID',
          `Tagihan ${current.invoice_number} sudah dibatalkan sebelumnya`,
        );
      }
      const voided: Invoice = {
        ...current,
        status: InvoiceStatus.VOID,
        voided_at: new Date(),
        void_reason: reason.trim(),
      };
      items.set(id, voided);
      return voided;
    },
    remove: async () => {
      throw new InvoiceError(
        'DELETE_FORBIDDEN',
        'Tagihan tidak dapat dihapus permanen. Gunakan pembatalan (void) dengan alasan.',
      );
    },
  } as unknown as InvoicesRepository;

  return { repo, items, customers };
}
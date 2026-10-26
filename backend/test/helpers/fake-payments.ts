import {
  InvoiceBalance,
  InvoiceBrief,
  LedgerSummary,
  MethodTotal,
  Payment,
  PaymentActor,
  PaymentError,
  PaymentFilters,
  PaymentPage,
  PaymentResult,
  PaymentsRepository,
} from '../../src/app/modules/payments/payments.repository';
import { CreatePaymentDto } from '../../src/app/modules/payments/dto/payment.dto';
import { nextInvoiceState } from '../../src/app/modules/payments/payments.domain';
import { FakeInvoices } from './fake-invoices';
import { InvoiceStatus } from '../../src/app/modules/invoices/dto/invoice.dto';

// Repository in-memory untuk e2e pembayaran: tidak menyentuh tabel payments.
// Aturan yang ditiru: SUM pembayaran sah menentukan status tagihan, kunci
// idempoten mengembalikan baris lama, kunci yang sudah di-void ditolak.
export type { LedgerSummary };

export interface FakePayments {
  repo: PaymentsRepository;
  items: Map<number, Payment>;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function createFakePayments(invoices: FakeInvoices): FakePayments {
  const items = new Map<number, Payment>();
  let nextId = 1;

  const invoice = (id: number) => {
    const row = invoices.items.get(id);
    if (!row) {
      throw new PaymentError('INVOICE_NOT_FOUND', `Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return row;
  };

  const paidTotal = (invoiceId: number) =>
    [...items.values()]
      .filter((p) => p.invoice_id === invoiceId && p.voided_at === null)
      .reduce((sum, p) => sum + p.amount, 0);

  const brief = (invoiceId: number): InvoiceBrief => {
    const row = invoice(invoiceId);
    return { id: row.id, status: row.status, paid_date: row.paid_date };
  };

  // Menulis ulang status tagihan dari SUM pembayaran sah — sama seperti SQL.
  const applyState = (invoiceId: number): void => {
    const row = invoice(invoiceId);
    const paid = paidTotal(invoiceId);
    const status = nextInvoiceState(row.amount, paid);
    const lastPaid = [...items.values()]
      .filter((p) => p.invoice_id === invoiceId && p.voided_at === null)
      .map((p) => p.paid_at.slice(0, 10))
      .sort()
      .pop();
    row.status = status as InvoiceStatus;
    row.paid_date = status === 'paid' ? (lastPaid ?? null) : null;
  };

  const byKey = (invoiceId: number, key: string) =>
    [...items.values()].find((p) => p.invoice_id === invoiceId && p.idempotency_key === key) ??
    null;

  const rejectVoided = (payment: Payment) => {
    if (payment.voided_at !== null) {
      throw new PaymentError(
        'IDEMPOTENT_VOIDED',
        `Pembayaran dengan kunci ini sudah dibatalkan (ID ${payment.id})`,
        undefined,
        payment.id,
      );
    }
  };

  const repo = {
    listByInvoice: async (invoiceId: number) =>
      [...items.values()]
        .filter((p) => p.invoice_id === invoiceId)
        .sort((a, b) => b.id - a.id)
        .map((p) => ({
          ...p,
          invoice_status: invoices.items.get(p.invoice_id)?.status ?? p.invoice_status,
        })),

    create: async (
      invoiceId: number,
      dto: CreatePaymentDto,
      actor: PaymentActor,
    ): Promise<PaymentResult> => {
      const row = invoice(invoiceId);

      if (dto.idempotency_key) {
        const existing = byKey(invoiceId, dto.idempotency_key);
        if (existing) {
          rejectVoided(existing);
          return { payment: existing, invoice: brief(invoiceId), created: false };
        }
      }

      const remaining = round2(row.amount - paidTotal(invoiceId));
      if (remaining <= 0) {
        throw new PaymentError('ALREADY_PAID', 'Tagihan sudah lunas', 0);
      }
      const amount = round2(dto.amount);
      if (amount > remaining) {
        throw new PaymentError('OVERPAY', 'Nominal melebihi sisa tagihan', remaining);
      }

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp =
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
        `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const payment: Payment = {
        id: nextId++,
        invoice_id: invoiceId,
        invoice_number: row.invoice_number,
        customer_name: row.customer_name,
        invoice_status: row.status,
        amount,
        method: dto.method ?? ('cash' as Payment['method']),
        reference: dto.reference ?? null,
        paid_at: dto.paid_at ? `${dto.paid_at} 00:00:00` : stamp,
        recorded_by: actor.id,
        recorded_by_name: actor.name,
        note: dto.note ?? '',
        idempotency_key: dto.idempotency_key ?? null,
        voided_at: null,
        voided_by: null,
        void_reason: null,
        created_at: now,
      };
      items.set(payment.id, payment);
      applyState(invoiceId);
      return { payment, invoice: brief(invoiceId), created: true };
    },

    search: async (filters: PaymentFilters, page: number, limit: number): Promise<PaymentPage> => {
      const like = filters.search?.toLowerCase();
      const rows = [...items.values()]
        .filter((payment) => {
          if (filters.invoiceId !== undefined && payment.invoice_id !== filters.invoiceId) return false;
          if (filters.from && payment.paid_at.slice(0, 10) < filters.from) return false;
          if (filters.to && payment.paid_at.slice(0, 10) > filters.to) return false;
          if (filters.method && payment.method !== filters.method) return false;
          if (filters.status === 'valid' && payment.voided_at !== null) return false;
          if (filters.status === 'void' && payment.voided_at === null) return false;
          if (like) {
            const haystack = [payment.invoice_number, payment.customer_name, payment.reference ?? '', payment.note]
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(like)) return false;
          }
          return true;
        })
        .sort((a, b) => b.id - a.id);

      const start = (page - 1) * limit;
      return {
        rows: rows.slice(start, start + limit).map((p) => ({
          ...p,
          invoice_status: invoices.items.get(p.invoice_id)?.status ?? p.invoice_status,
        })),
        total: rows.length,
        page,
        limit,
      };
    },

    incomeOf: async (from?: string, to?: string) => {
      const rows = [...items.values()].filter(
        (payment) =>
          payment.voided_at === null &&
          (!from || payment.paid_at.slice(0, 10) >= from) &&
          (!to || payment.paid_at.slice(0, 10) <= to),
      );
      return { income: round2(rows.reduce((sum, p) => sum + p.amount, 0)), transactions: rows.length };
    },

    outstanding: async (): Promise<{ outstanding: number; overdue: number }> => {
      const today = new Date().toISOString().slice(0, 10);
      let outstanding = 0;
      let overdue = 0;
      for (const inv of invoices.items.values()) {
        const remaining = round2(inv.amount - paidTotal(inv.id));
        if (remaining <= 0) continue;
        outstanding += remaining;
        if (inv.due_date.slice(0, 10) < today) overdue += remaining;
      }
      return { outstanding: round2(outstanding), overdue: round2(overdue) };
    },

    methodTotals: async (from?: string, to?: string): Promise<MethodTotal[]> => {
      const totals = new Map<string, MethodTotal>();
      for (const payment of items.values()) {
        if (payment.voided_at !== null) continue;
        if (from && payment.paid_at.slice(0, 10) < from) continue;
        if (to && payment.paid_at.slice(0, 10) > to) continue;
        const current = totals.get(payment.method) ?? { method: payment.method, transactions: 0, total: 0 };
        current.transactions += 1;
        current.total = round2(current.total + payment.amount);
        totals.set(payment.method, current);
      }
      return [...totals.values()].sort((a, b) => b.total - a.total);
    },

    payableInvoices: async (search: string | undefined, page: number, limit: number) => {
      const like = search?.toLowerCase();
      const today = new Date().toISOString().slice(0, 10);
      const rows: InvoiceBalance[] = [...invoices.items.values()]
        .map((inv) => {
          const paid = paidTotal(inv.id);
          return {
            id: inv.id,
            invoice_number: inv.invoice_number,
            customer_name: inv.customer_name,
            amount: inv.amount,
            paid_total: round2(paid),
            remaining: round2(inv.amount - paid),
            due_date: inv.due_date.slice(0, 10),
            status: inv.status,
            overdue: inv.due_date.slice(0, 10) < today && paid < inv.amount,
          };
        })
        .filter((row) => row.remaining > 0)
        .filter((row) =>
          like
            ? row.invoice_number.toLowerCase().includes(like) || row.customer_name.toLowerCase().includes(like)
            : true,
        )
        .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);

      const start = (page - 1) * limit;
      return { rows: rows.slice(start, start + limit), total: rows.length };
    },

    void: async (id: number, reason: string, actor: PaymentActor): Promise<PaymentResult> => {
      const payment = items.get(id);
      if (!payment) {
        throw new PaymentError('PAYMENT_NOT_FOUND', `Pembayaran dengan ID ${id} tidak ditemukan`);
      }
      if (payment.voided_at !== null) {
        throw new PaymentError('ALREADY_VOIDED', 'Pembayaran sudah dibatalkan', undefined, id);
      }
      if (reason.trim().length === 0) {
        throw new PaymentError('VOID_REASON_REQUIRED', 'Alasan void wajib diisi', undefined, id);
      }

      payment.voided_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      payment.voided_by = actor.id;
      payment.void_reason = reason.trim();
      applyState(payment.invoice_id);
      return { payment, invoice: brief(payment.invoice_id), created: false };
    },
  } as unknown as PaymentsRepository;

  return { repo, items };
}

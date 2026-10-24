import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateInvoiceDto, UpdateInvoiceDto, PayInvoiceDto, InvoiceStatus } from './dto/invoice.dto';

export interface Invoice {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  amount: number;
  status: InvoiceStatus;
  due_date: Date;
  paid_date?: Date;
  description: string;
  created_at: Date;
}

@Injectable()
export class InvoicesService {
  private invoices: Invoice[] = [];
  private counter = 1;

  findAll() {
    return this.invoices;
  }

  findOne(id: number) {
    const inv = this.invoices.find((i) => i.id === id);
    if (!inv) {
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }
    return inv;
  }

  findByCustomer(customerId: number) {
    return this.invoices.filter((i) => i.customer_id === customerId);
  }

  create(createDto: CreateInvoiceDto) {
    const now = new Date();
    const inv: Invoice = {
      id: this.counter++,
      invoice_number: `INV-2026-${(this.counter + 1000).toString().padStart(4, '0')}`,
      customer_id: createDto.customer_id,
      customer_name: `Pelanggan #${createDto.customer_id}`,
      amount: createDto.amount,
      status: createDto.status || InvoiceStatus.UNPAID,
      due_date: new Date(createDto.due_date),
      description: createDto.description || '',
      created_at: now,
    };
    this.invoices.push(inv);
    return inv;
  }

  pay(invoiceId: number, payDto: PayInvoiceDto) {
    const inv = this.findOne(invoiceId);
    inv.amount = payDto.amount;
    inv.status = InvoiceStatus.PAID;
    inv.paid_date = new Date();
    return inv;
  }

  update(id: number, updateDto: UpdateInvoiceDto) {
    const inv = this.findOne(id);
    Object.assign(inv, updateDto);
    return inv;
  }

  remove(id: number) {
    const index = this.invoices.findIndex((i) => i.id === id);
    if (index === -1) {
      throw new NotFoundException(`Tagihan dengan ID ${id} tidak ditemukan`);
    }
    this.invoices.splice(index, 1);
    return { ok: true };
  }

  getSummary() {
    const total = this.invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const paid = this.invoices.filter((i) => i.status === InvoiceStatus.PAID).length;
    const overdue = this.invoices.filter((i) => i.status === InvoiceStatus.OVERDUE).length;
    return { total, paid, overdue };
  }
}

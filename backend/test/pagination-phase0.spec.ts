import { describe, expect, it } from 'vitest';
import { CustomersService } from '../src/app/modules/customers/customers.service';
import { InvoicesService } from '../src/app/modules/invoices/invoices.service';
import { CustomersRepository } from '../src/app/modules/customers/customers.repository';
import { InvoicesRepository } from '../src/app/modules/invoices/invoices.repository';
import { UsersRepository } from '../src/app/modules/users/users.repository';

// Fase 0: kontrak pagination di level service. Repository diganti stub agar
// tidak ada koneksi database pada unit test.
const customer = (id: number, name: string, is_active = true) => ({
  id,
  name,
  email: `${name.toLowerCase()}@uji.test`,
  phone: '0800',
  address: '',
  is_active,
  created_at: new Date('2026-01-01'),
});

describe('Pagination Fase 0', () => {
  describe('CustomersService.list', () => {
    const repo = {
      findAll: async () => [customer(2, 'Siti'), customer(1, 'Budi', false)],
      findPage: async (query: { limit?: number; page?: number; search?: string; status?: string }) => {
        const rows = [customer(2, 'Siti'), customer(1, 'Budi', false)].filter((row) => {
          if (query.status === 'active' && !row.is_active) return false;
          if (query.status === 'inactive' && row.is_active) return false;
          if (query.search && !row.name.toLowerCase().includes(query.search.toLowerCase())) return false;
          return true;
        });
        return { rows: rows.slice(0, query.limit), total: rows.length };
      },
      hasOwnerColumn: async () => false,
      countRelations: async () => ({ invoices: 0, services: 0 }),
    } as unknown as CustomersRepository;

    const service = new CustomersService(repo, {} as UsersRepository);

    it('tanpa page mengembalikan array dan tetap menyaring di memori', async () => {
      const all = await service.list({});
      expect(Array.isArray(all)).toBe(true);
      expect(all).toHaveLength(2);

      const active = await service.list({ status: 'active' });
      expect(Array.isArray(active)).toBe(true);
      expect((active as Array<{ name: string }>)[0].name).toBe('Siti');
    });

    it('dengan page mengembalikan objek berpaginasi dan membatasi limit', async () => {
      const paged = await service.list({ page: 1, limit: 500 });
      expect(Array.isArray(paged)).toBe(false);
      expect(paged).toMatchObject({ page: 1, limit: 200 });
    });
  });

  describe('InvoicesService.list', () => {
    const rows = [
      { id: 2, invoice_number: 'INV-2', customer_id: 1, customer_name: 'Siti', amount: 200, status: 'paid', due_date: '2026-10-01', paid_date: null, description: '', created_at: new Date() },
      { id: 1, invoice_number: 'INV-1', customer_id: 1, customer_name: 'Budi', amount: 100, status: 'unpaid', due_date: '2026-10-01', paid_date: null, description: '', created_at: new Date() },
    ];
    const repo = {
      findAll: async () => rows,
      findPage: async (query: { status?: string; search?: string; limit?: number }) => {
        const filtered = rows.filter((row) => {
          if (query.status && row.status !== query.status) return false;
          if (query.search && !`${row.invoice_number} ${row.customer_name}`.toLowerCase().includes(query.search.toLowerCase())) return false;
          return true;
        });
        return { rows: filtered.slice(0, query.limit ?? 20), total: filtered.length };
      },
    } as unknown as InvoicesRepository;

    const service = new InvoicesService(repo);

    it('tanpa page tetap array (kompatibel)', async () => {
      const all = await service.list({});
      expect(Array.isArray(all)).toBe(true);
      expect(all).toHaveLength(2);
    });

    it('dengan page: total mengikuti filter yang sama dengan rows', async () => {
      const paged = (await service.list({ page: 1, limit: 1, status: 'unpaid' })) as {
        rows: unknown[];
        total: number;
        limit: number;
      };
      expect(paged.total).toBe(1);
      expect(paged.rows).toHaveLength(1);
      expect(paged.limit).toBe(1);
    });
  });

});

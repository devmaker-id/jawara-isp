import { CustomersRepository, Customer, CustomerRelations, CustomerQuery } from '../../src/app/modules/customers/customers.repository';

// Repository pelanggan in-memory untuk e2e Fase 0: tidak menyentuh tabel
// customers nyata. `ownerColumn` mensimulasikan ada/tidaknya kolom
// reseller_id (migrasi 003).
export interface FakeAuditEntry {
  user_id: number;
  action: string;
  details: { customer_id: number; previous_owner_id: number | null; new_owner_id: number | null; actor_id: number };
  ip_address: string;
}

export interface FakeCustomers {
  repo: CustomersRepository;
  items: Map<number, Customer & { reseller_id: number | null }>;
  relations: Map<number, CustomerRelations>;
  audit: FakeAuditEntry[];
  setOwnerColumn(value: boolean): void;
}

const base = {
  phone: '0800000000',
  address: 'Jl. Uji 1',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

export function createFakeCustomers(options: { ownerColumn?: boolean } = {}): FakeCustomers {
  let ownerColumn = options.ownerColumn ?? false;
  const items = new Map<number, Customer & { reseller_id: number | null }>([
    [1, { id: 1, name: 'Budi Santoso', email: 'budi@uji.test', ...base, reseller_id: null }],
    [2, { id: 2, name: 'Siti Aminah', email: 'siti@uji.test', ...base, reseller_id: null }],
    [3, { id: 3, name: 'Tanpa Riwayat', email: 'baru@uji.test', ...base, reseller_id: null }],
  ]);
  const relations = new Map<number, CustomerRelations>([
    [1, { invoices: 2, services: 1 }],
    [2, { invoices: 0, services: 0 }],
    [3, { invoices: 0, services: 0 }],
  ]);
  const audit: FakeAuditEntry[] = [];
  let nextId = 4;

  const repo = {
    findAll: async () => [...items.values()].sort((a, b) => b.id - a.id),
    findPage: async (query: CustomerQuery) => {
      const needle = query.search?.trim().toLowerCase();
      const filtered = [...items.values()]
        .filter((c) => {
          if (query.status === 'active' && !c.is_active) return false;
          if (query.status === 'inactive' && c.is_active) return false;
          if (!needle) return true;
          return `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(needle);
        })
        .sort((a, b) => b.id - a.id);
      const limit = Math.max(1, Math.min(200, query.limit ?? 20));
      const page = Math.max(1, query.page ?? 1);
      return { rows: filtered.slice((page - 1) * limit, page * limit), total: filtered.length };
    },
    findById: async (id: number) => items.get(id) ?? null,
    findByEmail: async (email: string) =>
      [...items.values()].find((c) => c.email.toLowerCase() === email.trim().toLowerCase()) ?? null,
    hasOwnerColumn: async () => ownerColumn,
    countRelations: async (id: number) => relations.get(id) ?? { invoices: 0, services: 0 },
    assignOwner: async (
      customerId: number,
      newOwnerId: number | null,
      actor: { userId: number; ip: string },
    ) => {
      if (!ownerColumn) throw new Error('kolom reseller_id tidak ada');
      const current = items.get(customerId);
      if (!current) {
        const missing = new Error('Pelanggan tidak ditemukan');
        (missing as { code?: string }).code = 'CUSTOMER_NOT_FOUND';
        throw missing;
      }
      const previousOwnerId = current.reseller_id;
      items.set(customerId, { ...current, reseller_id: newOwnerId });
      audit.push({
        user_id: actor.userId,
        action: 'CUSTOMER_OWNER_ASSIGNED',
        details: {
          customer_id: customerId,
          previous_owner_id: previousOwnerId,
          new_owner_id: newOwnerId,
          actor_id: actor.userId,
        },
        ip_address: actor.ip,
      });
      return { previousOwnerId };
    },
    create: async (dto: { name: string; email: string; phone: string; address: string; is_active?: boolean }) => {
      const created = {
        id: nextId++,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        is_active: dto.is_active !== false,
        created_at: new Date(),
        reseller_id: null,
      };
      items.set(created.id, created);
      return created;
    },
    update: async (id: number, dto: Record<string, unknown>) => {
      const current = items.get(id);
      if (!current) return null;
      const updated = { ...current, ...dto } as Customer & { reseller_id: number | null };
      items.set(id, updated);
      return updated;
    },
    remove: async (id: number) => items.delete(id),
  } as unknown as CustomersRepository;

  return {
    repo,
    items,
    relations,
    audit,
    setOwnerColumn: (value: boolean) => {
      ownerColumn = value;
    },
  };
}
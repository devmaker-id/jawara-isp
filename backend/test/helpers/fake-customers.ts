import { CustomersRepository, Customer, CustomerRelations, CustomerQuery } from '../../src/app/modules/customers/customers.repository';

// Repository pelanggan in-memory untuk e2e Fase 0: tidak menyentuh tabel
// customers nyata. `ownerColumn` mensimulasikan ada/tidaknya kolom
// owner_id (migrasi 003).
export interface FakeAuditEntry {
  user_id: number;
  action: string;
  details: { customer_id: number; previous_owner_id: number | null; new_owner_id: number | null; actor_id: number };
  ip_address: string;
}

export interface FakeCustomers {
  repo: CustomersRepository;
  items: Map<number, Customer & { owner_id: number | null }>;
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
  const items = new Map<number, Customer & { owner_id: number | null }>([
    [1, { id: 1, name: 'Budi Santoso', email: 'budi@uji.test', ...base, owner_id: null }],
    [2, { id: 2, name: 'Siti Aminah', email: 'siti@uji.test', ...base, owner_id: null }],
    [3, { id: 3, name: 'Tanpa Riwayat', email: 'baru@uji.test', ...base, owner_id: null }],
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
    // Akun RADIUS pelanggan. Fake ini tidak punya tabel RADIUS, jadi kosong.
    assignOwner: async (
      customerId: number,
      newOwnerId: number | null,
      actor: { userId: number; ip: string },
    ) => {
      if (!ownerColumn) throw new Error('kolom owner_id tidak ada');
      const current = items.get(customerId);
      if (!current) {
        const missing = new Error('Pelanggan tidak ditemukan');
        (missing as { code?: string }).code = 'CUSTOMER_NOT_FOUND';
        throw missing;
      }
      const previousOwnerId = current.owner_id;
      items.set(customerId, { ...current, owner_id: newOwnerId });
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
    // Kontrak repository: create() mengembalikan ID, bukan objek pelanggan —
    // service membaca ulang lewat findOne agar akun RADIUS ikut terbawa.
    create: async (dto: {
      name: string;
      email: string;
      phone: string;
      address: string;
      is_active?: boolean;
      owner_id?: number | null;
    }, options?: { status?: string }) => {
      const created = {
        id: nextId++,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        is_active: dto.is_active !== false,
        status: options?.status ?? (dto.is_active === false ? 'disable' : 'active'),
        created_at: new Date(),
        owner_id: dto.owner_id ?? null,
      };
      items.set(created.id, created);
      return created.id;
    },
    // Akun RADIUS: fake ini tidak punya tabel RADIUS.
    findAccounts: async () => [],
    findProfile: async () => null,
    findAccountByUsername: async () => null,
    updateAccount: async () => 0,
    update: async (id: number, dto: Record<string, unknown>) => {
      const current = items.get(id);
      if (!current) return null;
      const updated = { ...current, ...dto } as Customer & { owner_id: number | null };
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
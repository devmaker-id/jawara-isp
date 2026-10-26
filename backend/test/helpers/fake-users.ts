import { UsersRepository, UserRecord, CreateUserRecord, UpdateUserRecord } from '../../src/app/modules/users/users.repository';
import { PasswordService } from '../../src/app/modules/auth/password.service';

// Repository pengganti untuk e2e: tidak menyentuh database sama sekali.
// Dipakai agar test otorisasi/login tidak bergantung pada isi tabel users
// yang sebenarnya (dan tidak menulis data apa pun).
export const TEST_PASSWORD = 'RahasiaUji#2026';

let cachedHash: string | null = null;

export async function testPasswordHash(): Promise<string> {
  if (!cachedHash) {
    cachedHash = await new PasswordService().hash(TEST_PASSWORD);
  }
  return cachedHash;
}

export interface FakeUsers {
  repo: UsersRepository;
  accounts: Map<number, UserRecord>;
  // Menandai akun punya jejak audit/transaksi (untuk menguji larangan hapus).
  references: Map<number, number>;
}

export async function createFakeUsers(): Promise<FakeUsers> {
  const hash = await testPasswordHash();
  const base = {
    password_hash: hash,
    phone: null,
    address: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  const accounts = new Map<number, UserRecord>([
    [1, { id: 1, name: 'Admin Uji', email: 'admin@uji.test', role: 'admin', ...base }],
    [2, { id: 2, name: 'Operator Uji', email: 'operator@uji.test', role: 'operator', ...base }],
    [3, { id: 3, name: 'Reseller Uji', email: 'reseller@uji.test', role: 'resseler', ...base }],
  ]);

  let nextId = 4;
  const references = new Map<number, number>();

  const repo = {
    findAll: async () => [...accounts.values()],
    findById: async (id: number) => accounts.get(id) ?? null,
    findByEmail: async (email: string) => {
      const target = email.trim().toLowerCase();
      return [...accounts.values()].find((u) => u.email.toLowerCase() === target) ?? null;
    },
    existsByEmail: async (email: string) => {
      const target = email.trim().toLowerCase();
      return [...accounts.values()].some((u) => u.email.toLowerCase() === target);
    },
    countAll: async () => accounts.size,
    // Pagination dihitung di sini agar perilaku service tetap teruji tanpa DB.
    findPage: async (query: {
      search?: string;
      role?: string;
      isActive?: boolean;
      page?: number;
      limit?: number;
    }) => {
      const needle = query.search?.trim().toLowerCase();
      const filtered = [...accounts.values()].filter((u) => {
        if (query.role && u.role !== query.role) return false;
        if (query.isActive !== undefined && u.is_active !== query.isActive) return false;
        if (needle && !`${u.name} ${u.email}`.toLowerCase().includes(needle)) return false;
        return true;
      });
      const limit = Math.max(1, query.limit ?? 20);
      const page = Math.max(1, query.page ?? 1);
      return {
        rows: filtered.slice((page - 1) * limit, page * limit),
        total: filtered.length,
      };
    },
    countActiveAdminsExcept: async (id: number) =>
      [...accounts.values()].filter((u) => u.role === 'admin' && u.is_active && u.id !== id)
        .length,
    countReferences: async (id: number) => references.get(id) ?? 0,
    countAdmins: async () =>
      [...accounts.values()].filter((u) => u.role === 'admin' && u.is_active).length,
    create: async (data: CreateUserRecord) => {
      const created: UserRecord = {
        id: nextId++,
        name: data.name,
        email: data.email,
        password_hash: data.password_hash,
        role: data.role,
        phone: data.phone ?? null,
        address: data.address ?? null,
        is_active: data.is_active !== false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      accounts.set(created.id, created);
      return created;
    },
    update: async (id: number, data: UpdateUserRecord) => {
      const current = accounts.get(id);
      if (!current) return null;
      const updated: UserRecord = {
        ...current,
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        updated_at: new Date(),
      } as UserRecord;
      accounts.set(id, updated);
      return updated;
    },
    remove: async (id: number) => accounts.delete(id),
  } as unknown as UsersRepository;

  return { repo, accounts, references };
}

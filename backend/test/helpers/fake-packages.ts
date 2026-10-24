import { PackagesRepository, Package } from '../../src/app/modules/packages/packages.repository';
import type { CreatePackageDto, UpdatePackageDto } from '../../src/app/modules/packages/dto/package.dto';

// Repository in-memory untuk e2e paket: tidak menyentuh tabel packages
// sebenarnya. Perilaku (unik nama, affectedRows) meniru MySQL.
export interface FakePackages {
  repo: PackagesRepository;
  items: Map<number, Package>;
}

export function createFakePackages(): FakePackages {
  const items = new Map<number, Package>();
  let nextId = 1;

  const byName = (name: string) =>
    [...items.values()].find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

  const repo = {
    findAll: async () => [...items.values()].sort((a, b) => b.id - a.id),
    findById: async (id: number) => items.get(id) ?? null,
    findByName: async (name: string) => byName(name),
    create: async (dto: CreatePackageDto) => {
      if (byName(dto.name)) {
        throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      }
      const created: Package = {
        id: nextId++,
        name: dto.name.trim(),
        description: dto.description,
        price: dto.price,
        data_limit: dto.data_limit,
        speed: dto.speed,
        valid_days: dto.valid_days,
        is_active: dto.is_active !== false,
        created_at: new Date(),
      };
      items.set(created.id, created);
      return created;
    },
    update: async (id: number, dto: UpdatePackageDto) => {
      const current = items.get(id);
      if (!current) return null;
      const updated: Package = {
        ...current,
        ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
        updated_at: undefined,
      } as Package;
      items.set(id, updated);
      return updated;
    },
    remove: async (id: number) => items.delete(id),
  } as unknown as PackagesRepository;

  return { repo, items };
}

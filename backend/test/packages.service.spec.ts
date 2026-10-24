import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PackagesService } from '../src/app/modules/packages/packages.service';
import type { Package, PackagesRepository } from '../src/app/modules/packages/packages.repository';

function makePackage(overrides: Partial<Package> = {}): Package {
  return {
    id: 1,
    name: '30Mbps Unlimited',
    description: 'Paket tanpa batas',
    price: 49500.5,
    data_limit: 'Unlimited',
    speed: 30,
    valid_days: 30,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(): PackagesRepository {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as PackagesRepository;
}

describe('PackagesService', () => {
  let repo: PackagesRepository;
  let service: PackagesService;

  beforeEach(() => {
    repo = makeRepo();
    service = new PackagesService(repo);
  });

  it('menolak nama paket duplikat dengan ConflictException', async () => {
    vi.mocked(repo.findByName).mockResolvedValue(makePackage({ id: 3 }));

    await expect(
      service.create({
        name: '30Mbps Unlimited',
        description: 'd',
        price: 1000,
        data_limit: '1GB',
        speed: 10,
        valid_days: 30,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('menerjemahkan ER_DUP_ENTRY menjadi ConflictException', async () => {
    vi.mocked(repo.findByName).mockResolvedValue(null);
    vi.mocked(repo.create).mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }),
    );

    await expect(
      service.create({
        name: 'Baru',
        description: 'd',
        price: 1000,
        data_limit: '1GB',
        speed: 10,
        valid_days: 30,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('menerjemahkan database tidak tersedia menjadi 503', async () => {
    vi.mocked(repo.findAll).mockRejectedValue(
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    );

    await expect(service.findAll()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('melempar NotFound saat paket tidak ada', async () => {
    vi.mocked(repo.findById).mockResolvedValue(null);

    await expect(service.findOne(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('melempar NotFound saat menghapus paket yang tidak ada', async () => {
    vi.mocked(repo.remove).mockResolvedValue(false);

    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mengizinkan update dengan nama milik paket itu sendiri', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makePackage({ id: 2, name: 'Sama' }));
    vi.mocked(repo.findByName).mockResolvedValue(makePackage({ id: 2, name: 'Sama' }));
    vi.mocked(repo.update).mockResolvedValue(makePackage({ id: 2, name: 'Sama' }));

    await expect(service.update(2, { name: 'Sama' })).resolves.toMatchObject({ id: 2 });
  });

  it('menolak update ke nama milik paket lain', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makePackage({ id: 2, name: 'Lama' }));
    vi.mocked(repo.findByName).mockResolvedValue(makePackage({ id: 9, name: 'Dipakai' }));

    await expect(service.update(2, { name: 'Dipakai' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('mengembalikan harga desimal apa adanya dari repository', async () => {
    vi.mocked(repo.findAll).mockResolvedValue([makePackage({ price: 29700.99 })]);

    const [pkg] = await service.findAll();
    expect(pkg.price).toBe(29700.99);
  });
});

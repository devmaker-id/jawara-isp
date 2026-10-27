import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersService } from '../src/app/modules/customers/customers.service';
import type { Customer, CustomersRepository } from '../src/app/modules/customers/customers.repository';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: 'Budi Santoso',
    email: 'budi@example.com',
    phone: '08123456789',
    address: 'Jl. Merdeka 1',
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(): CustomersRepository {
  return {
    findAll: vi.fn(),
    findPage: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    hasOwnerColumn: vi.fn().mockResolvedValue(false),
    countRelations: vi.fn().mockResolvedValue({ invoices: 0, services: 0 }),
    // Akun RADIUS milik pelanggan; kosong bila pelanggan belum punya akun.
    findAccounts: vi.fn().mockResolvedValue([]),
    assignOwner: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as CustomersRepository;
}

describe('CustomersService', () => {
  let repo: CustomersRepository;
  let service: CustomersService;

  beforeEach(() => {
    repo = makeRepo();
    service = new CustomersService(repo, {} as never);
  });

  it('menolak email duplikat dengan ConflictException (bukan 500)', async () => {
    vi.mocked(repo.findByEmail).mockResolvedValue(makeCustomer({ id: 7, email: 'ada@example.com' }));

    await expect(
      service.create({ name: 'Baru', email: 'ada@example.com', phone: '0812' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('menerjemahkan ER_DUP_ENTRY dari database menjadi ConflictException', async () => {
    vi.mocked(repo.findByEmail).mockResolvedValue(null);
    vi.mocked(repo.create).mockRejectedValue(
      Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }),
    );

    await expect(
      service.create({ name: 'Baru', email: 'baru@example.com', phone: '0812' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('menerjemahkan database tidak tersedia menjadi ServiceUnavailableException', async () => {
    vi.mocked(repo.findAll).mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    await expect(service.findAll()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('melempar NotFoundException saat pelanggan tidak ada', async () => {
    vi.mocked(repo.findById).mockResolvedValue(null);

    await expect(service.findOne(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('melempar NotFoundException saat menghapus pelanggan yang tidak ada', async () => {
    vi.mocked(repo.findById).mockResolvedValue(null);
    vi.mocked(repo.remove).mockResolvedValue(false);

    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('menolak hapus pelanggan yang masih punya tagihan/sesi layanan', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ id: 5 }));
    vi.mocked(repo.countRelations).mockResolvedValue({ invoices: 3, services: 1 });

    await expect(service.remove(5)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('mengizinkan update dengan email milik pelanggan itu sendiri', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ id: 3, email: 'sama@example.com' }));
    vi.mocked(repo.findByEmail).mockResolvedValue(makeCustomer({ id: 3, email: 'sama@example.com' }));
    vi.mocked(repo.update).mockResolvedValue(makeCustomer({ id: 3, email: 'sama@example.com' }));

    await expect(service.update(3, { email: 'sama@example.com' })).resolves.toMatchObject({ id: 3 });
  });

  it('menolak update ke email milik pelanggan lain', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ id: 3, email: 'lama@example.com' }));
    vi.mocked(repo.findByEmail).mockResolvedValue(makeCustomer({ id: 9, email: 'dipakai@example.com' }));

    await expect(service.update(3, { email: 'dipakai@example.com' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

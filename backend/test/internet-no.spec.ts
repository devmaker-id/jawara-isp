import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersService } from '../src/app/modules/customers/customers.service';
import type { Customer, CustomersRepository } from '../src/app/modules/customers/customers.repository';

// Nomor Internet: identitas permanen pelanggan. Aturan yang diuji di sini
// adalah aturan yang kalau bocor akan merusak data: nomor ganda, nomor yang
// bisa diedit, dan pencarian yang salah orang.

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: 'Budi Santoso',
    internet_no: '1312013',
    email: 'budi@example.com',
    phone: '08123456789',
    address: 'Jl. Merdeka 1',
    is_active: true,
    status: 'active',
    owner_id: null,
    owner_name: null,
    created_by: null,
    created_by_name: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(): CustomersRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findPage: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    findById: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByInternetNo: vi.fn().mockResolvedValue(null),
    hasOwnerColumn: vi.fn().mockResolvedValue(true),
    countRelations: vi.fn().mockResolvedValue({ invoices: 0, services: 0 }),
    findAccounts: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(1),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as CustomersRepository;
}

describe('Nomor Internet — CustomersService', () => {
  let repo: CustomersRepository;
  let service: CustomersService;

  beforeEach(() => {
    repo = makeRepo();
    service = new CustomersService(repo, {} as never, {} as never, {} as never);
  });

  it('menolak nomor yang sudah dipakai pelanggan lain (409, bukan 500)', async () => {
    vi.mocked(repo.findByInternetNo).mockResolvedValue(
      makeCustomer({ id: 9, name: 'Siti', internet_no: '1312013' }),
    );

    await expect(
      service.create({ name: 'Baru', email: 'baru@example.com', phone: '0812', internet_no: '1312013' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('meneruskan nomor yang dikirim operator ke repository', async () => {
    vi.mocked(repo.create).mockResolvedValue(5);
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ id: 5, internet_no: '1312999' }));

    const hasil = await service.create({
      name: 'Baru',
      email: 'baru@example.com',
      phone: '0812',
      internet_no: '1312999',
    });

    expect(vi.mocked(repo.create).mock.calls[0][0].internet_no).toBe('1312999');
    expect(hasil.internet_no).toBe('1312999');
  });

  it('pelanggan tanpa nomor tetap bisa dibuat (nomor dibuat repository/database)', async () => {
    vi.mocked(repo.create).mockResolvedValue(6);
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ id: 6, internet_no: null }));

    const hasil = await service.create({ name: 'Tanpa Nomor', email: 'tn@example.com', phone: '0813' });

    // Service tidak mengarang nomor; kalau tidak dikirim, biar repository
    // (penghitung database) yang memutuskan — termasuk memutuskan NULL.
    expect(vi.mocked(repo.create).mock.calls[0][0].internet_no).toBeUndefined();
    expect(hasil.internet_no).toBeNull();
  });

  it('menolak penggantian nomor yang sudah terbit', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ internet_no: '1312013' }));

    await expect(service.update(1, { internet_no: '9999999' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('mengizinkan nomor diisi pada pelanggan lama yang masih NULL', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ internet_no: null }));
    vi.mocked(repo.update).mockResolvedValue(makeCustomer({ internet_no: '1312500' }));

    await service.update(1, { internet_no: '1312500' });

    expect(vi.mocked(repo.update).mock.calls[0][1].internet_no).toBe('1312500');
  });

  it('mengirim nomor yang sama tidak dianggap perubahan', async () => {
    vi.mocked(repo.findById).mockResolvedValue(makeCustomer({ internet_no: '1312013' }));
    vi.mocked(repo.update).mockResolvedValue(makeCustomer({ internet_no: '1312013' }));

    await expect(service.update(1, { internet_no: '1312013' })).resolves.toBeTruthy();
  });

  it('menerjemahkan duplikat dari index database menjadi pesan yang jelas', async () => {
    vi.mocked(repo.create).mockRejectedValue(
      Object.assign(new Error("Duplicate entry '1312013' for key 'uq_customers_internet_no'"), {
        code: 'ER_DUP_ENTRY',
      }),
    );

    await expect(
      service.create({ name: 'Balapan', email: 'balapan@example.com', phone: '0814', internet_no: '1312013' }),
    ).rejects.toThrow(/Nomor Internet sudah dipakai/);
  });

  it('mencari pelanggan menurut Nomor Internet, lengkap dengan akun RADIUS', async () => {
    vi.mocked(repo.findByInternetNo).mockResolvedValue(makeCustomer({ id: 4 }));
    vi.mocked(repo.findAccounts).mockResolvedValue([
      {
        id: 1,
        username: 'arka@jm.net',
        profile_type: 'ppp',
        profile_id: 3,
        profile_name: 'PPP 10M',
        user_type: 'member',
        status: 'active',
        expires_at: null,
        online: true,
        last_seen: null,
      },
    ]);

    const hasil = await service.findByInternetNo('1312013');

    expect(hasil.id).toBe(4);
    expect(hasil.accounts?.[0].username).toBe('arka@jm.net');
  });

  it('nomor yang tidak dikenal menghasilkan 404 yang menyebut nomornya', async () => {
    await expect(service.findByInternetNo('0000000')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findByInternetNo('0000000')).rejects.toThrow(/0000000/);
  });
});

describe('Migrasi 028 — struktur yang tidak boleh hilang', () => {
  const sql = readFileSync(
    resolve(__dirname, '../migrations/028_customer_internet_no.sql'),
    'utf8',
  );

  it('menambah kolom internet_no nullable', () => {
    expect(sql).toMatch(/ADD COLUMN internet_no VARCHAR\(20\) NULL/);
  });

  it('memasang unique dan check bentuk nomor', () => {
    expect(sql).toContain('uq_customers_internet_no');
    expect(sql).toContain('chk_customers_internet_no');
  });

  it('menyediakan penghitung nomor berbasis database', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS internet_no_sequence');
  });

  it('tidak mengubah atau menghapus data pelanggan lama', () => {
    expect(sql).not.toMatch(/UPDATE\s+customers/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+customers/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});

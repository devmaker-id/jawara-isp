import { describe, expect, it, vi } from 'vitest';
import { PackagesRepository } from '../src/app/modules/packages/packages.repository';
import type { DatabaseService } from '../src/app/database/database.service';

// Semua test memakai mock DatabaseService — tidak ada koneksi ke database.
function makeDb(overrides: Partial<DatabaseService> = {}): DatabaseService {
  return {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }),
    ...overrides,
  } as unknown as DatabaseService;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: '30Mbps Unlimited',
    description: 'Paket tanpa batas',
    price: 49500.5,
    data_limit: 'Unlimited',
    speed: 30,
    valid_days: 30,
    is_active: 1,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PackagesRepository', () => {
  describe('pemetaan tipe', () => {
    it('mengubah price DECIMAL string menjadi number tanpa kehilangan desimal', async () => {
      // mysql2 mengembalikan DECIMAL sebagai string bila decimalNumbers tidak aktif.
      const db = makeDb({ query: vi.fn().mockResolvedValue([row({ price: '49500.50' })]) });
      const repo = new PackagesRepository(db);

      const [pkg] = await repo.findAll();
      expect(typeof pkg.price).toBe('number');
      expect(pkg.price).toBe(49500.5);
      // Presisi dua desimal tetap utuh saat diformat.
      expect(pkg.price.toFixed(2)).toBe('49500.50');
    });

    it('mempertahankan harga dengan desimal .99', async () => {
      const db = makeDb({ query: vi.fn().mockResolvedValue([row({ price: '1234567.99' })]) });
      const repo = new PackagesRepository(db);

      const [pkg] = await repo.findAll();
      expect(pkg.price).toBe(1234567.99);
    });

    it('menerima price yang sudah number (decimalNumbers aktif)', async () => {
      const db = makeDb({ query: vi.fn().mockResolvedValue([row({ price: 29700.25 })]) });
      const repo = new PackagesRepository(db);

      const [pkg] = await repo.findAll();
      expect(pkg.price).toBe(29700.25);
    });

    it('mengubah is_active TINYINT menjadi boolean', async () => {
      const db = makeDb({
        query: vi.fn().mockResolvedValue([row({ id: 1, is_active: 1 }), row({ id: 2, is_active: 0 })]),
      });
      const repo = new PackagesRepository(db);

      const list = await repo.findAll();
      expect(list[0].is_active).toBe(true);
      expect(list[1].is_active).toBe(false);
    });

    it('speed dan valid_days dipaksa menjadi number', async () => {
      const db = makeDb({ query: vi.fn().mockResolvedValue([row({ speed: '50', valid_days: '30' })]) });
      const repo = new PackagesRepository(db);

      const [pkg] = await repo.findAll();
      expect(pkg.speed).toBe(50);
      expect(pkg.valid_days).toBe(30);
    });
  });

  describe('tabel kosong', () => {
    it('findAll mengembalikan array kosong', async () => {
      const repo = new PackagesRepository(makeDb());
      await expect(repo.findAll()).resolves.toEqual([]);
    });

    it('findById mengembalikan null', async () => {
      const repo = new PackagesRepository(makeDb());
      await expect(repo.findById(99)).resolves.toBeNull();
    });
  });

  describe('paket tidak ditemukan', () => {
    it('update mengembalikan null saat affectedRows = 0', async () => {
      const repo = new PackagesRepository(
        makeDb({ execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }) }),
      );
      await expect(repo.update(99, { name: 'Baru' })).resolves.toBeNull();
    });

    it('remove mengembalikan false saat affectedRows = 0', async () => {
      const repo = new PackagesRepository(
        makeDb({ execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }) }),
      );
      await expect(repo.remove(99)).resolves.toBe(false);
    });

    it('create melempar error bila baris tidak dapat dibaca kembali', async () => {
      const repo = new PackagesRepository(
        makeDb({
          execute: vi.fn().mockResolvedValue({ insertId: 5, affectedRows: 1 }),
          queryOne: vi.fn().mockResolvedValue(null),
        }),
      );

      await expect(
        repo.create({
          name: 'X',
          description: 'd',
          price: 1000,
          data_limit: '1GB',
          speed: 10,
          valid_days: 30,
        }),
      ).rejects.toThrow(/Gagal membaca paket/);
    });
  });

  describe('query yang dijalankan', () => {
    it('create memakai query parameterized dengan urutan kolom benar', async () => {
      const execute = vi.fn().mockResolvedValue({ insertId: 1, affectedRows: 1 });
      const repo = new PackagesRepository(
        makeDb({ execute, queryOne: vi.fn().mockResolvedValue(row()) }),
      );

      await repo.create({
        name: '  Paket Uji  ',
        description: 'd',
        price: 1234.56,
        data_limit: '10GB',
        speed: 20,
        valid_days: 30,
        is_active: false,
      });

      const [sql, params] = execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO packages');
      expect(params).toEqual(['Paket Uji', 'd', 1234.56, '10GB', 20, 30, 0]);
    });

    it('update tanpa field tidak menjalankan UPDATE', async () => {
      const execute = vi.fn();
      const repo = new PackagesRepository(
        makeDb({ execute, queryOne: vi.fn().mockResolvedValue(row()) }),
      );

      await repo.update(1, {});
      expect(execute).not.toHaveBeenCalled();
    });

    it('findByName memakai perbandingan case-insensitive', async () => {
      const queryOne = vi.fn().mockResolvedValue(row());
      const repo = new PackagesRepository(makeDb({ queryOne }));

      await repo.findByName('  paket UJI  ');

      const [sql, params] = queryOne.mock.calls[0];
      expect(sql).toContain('LOWER(name) = LOWER(?)');
      expect(params).toEqual(['paket UJI']);
    });
  });

  describe('error database', () => {
    it('meneruskan ECONNREFUSED agar service memetakan ke 503', async () => {
      const repo = new PackagesRepository(
        makeDb({
          query: vi
            .fn()
            .mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })),
        }),
      );

      await expect(repo.findAll()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });
  });
});

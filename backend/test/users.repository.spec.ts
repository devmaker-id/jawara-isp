import { describe, expect, it, vi } from 'vitest';
import { UsersRepository } from '../src/app/modules/users/users.repository';
import type { DatabaseService } from '../src/app/database/database.service';

// Semua test memakai mock DatabaseService — tidak ada koneksi atau perubahan
// data pada server.
function makeDb(overrides: Partial<DatabaseService> = {}): DatabaseService {
  return {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }),
    ...overrides,
  } as unknown as DatabaseService;
}

const row = {
  id: 1,
  name: 'Administrator',
  email: 'admin@jawara-billing.com',
  password_hash: '$2b$12$contohhashuntuktest',
  role: 'admin',
  phone: null,
  address: null,
  is_active: 1,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

describe('UsersRepository', () => {
  describe('tabel users kosong', () => {
    it('findAll mengembalikan array kosong', async () => {
      const repo = new UsersRepository(makeDb());
      await expect(repo.findAll()).resolves.toEqual([]);
    });

    it('findById mengembalikan null, bukan melempar error', async () => {
      const repo = new UsersRepository(makeDb());
      await expect(repo.findById(1)).resolves.toBeNull();
    });

    it('findByEmail mengembalikan null', async () => {
      const repo = new UsersRepository(makeDb());
      await expect(repo.findByEmail('tidak-ada@example.test')).resolves.toBeNull();
    });

    it('existsByEmail mengembalikan false', async () => {
      const repo = new UsersRepository(makeDb());
      await expect(repo.existsByEmail('tidak-ada@example.test')).resolves.toBe(false);
    });
  });

  describe('pengguna tidak ditemukan', () => {
    it('update mengembalikan null saat affectedRows = 0', async () => {
      const db = makeDb({
        execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }),
      });
      const repo = new UsersRepository(db);

      await expect(repo.update(99, { name: 'Baru' })).resolves.toBeNull();
    });

    it('remove mengembalikan false saat affectedRows = 0', async () => {
      const db = makeDb({
        execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }),
      });
      const repo = new UsersRepository(db);

      await expect(repo.remove(99)).resolves.toBe(false);
    });

    it('create melempar error bila baris tidak dapat dibaca kembali', async () => {
      const db = makeDb({
        execute: vi.fn().mockResolvedValue({ insertId: 5, affectedRows: 1 }),
        queryOne: vi.fn().mockResolvedValue(null),
      });
      const repo = new UsersRepository(db);

      await expect(
        repo.create({
          name: 'X',
          email: 'x@example.test',
          password_hash: '$2b$12$hash',
          role: 'operator',
        }),
      ).rejects.toThrow(/Gagal membaca pengguna/);
    });
  });

  describe('pemetaan data', () => {
    it('mengubah is_active TINYINT menjadi boolean', async () => {
      const db = makeDb({
        query: vi.fn().mockResolvedValue([row, { ...row, id: 2, is_active: 0 }]),
      });
      const repo = new UsersRepository(db);

      const users = await repo.findAll();
      expect(users[0].is_active).toBe(true);
      expect(users[1].is_active).toBe(false);
    });

    it('findByEmail menormalisasi kapitalisasi dan spasi', async () => {
      const queryOne = vi.fn().mockResolvedValue(row);
      const repo = new UsersRepository(makeDb({ queryOne }));

      await repo.findByEmail('  ADMIN@Jawara-Billing.com  ');

      const [sql, params] = queryOne.mock.calls[0];
      expect(sql).toContain('LOWER(email) = LOWER(?)');
      expect(params).toEqual(['ADMIN@Jawara-Billing.com']);
    });

    it('create tidak pernah menulis is_active selain 0/1', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ insertId: 1, affectedRows: 1 })
        .mockResolvedValueOnce({ insertId: 0, affectedRows: 0 });
      const repo = new UsersRepository(makeDb({ execute, queryOne: vi.fn().mockResolvedValue(row) }));

      await repo.create({
        name: 'X',
        email: 'x@example.test',
        password_hash: '$2b$12$hash',
        role: 'operator',
        is_active: false,
      });

      const [, params] = execute.mock.calls[0];
      expect(params[6]).toBe(0);
    });

    it('update tanpa field tidak menjalankan UPDATE', async () => {
      const execute = vi.fn();
      const repo = new UsersRepository(makeDb({ execute, queryOne: vi.fn().mockResolvedValue(row) }));

      await repo.update(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('error database', () => {
    it('meneruskan ER_DUP_ENTRY agar pemanggil dapat memetakan ke 409', async () => {
      const db = makeDb({
        execute: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' })),
      });
      const repo = new UsersRepository(db);

      await expect(
        repo.create({
          name: 'Dup',
          email: 'dup@example.test',
          password_hash: '$2b$12$hash',
          role: 'operator',
        }),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });

    it('meneruskan ECONNREFUSED agar pemanggil dapat memetakan ke 503', async () => {
      const db = makeDb({
        query: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      });
      const repo = new UsersRepository(db);

      await expect(repo.findAll()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });
  });

  describe('isValidRole', () => {
    it('menerima role sah dan menolak yang lain', () => {
      expect(UsersRepository.isValidRole('admin')).toBe(true);
      expect(UsersRepository.isValidRole('operator')).toBe(true);
      expect(UsersRepository.isValidRole('resseler')).toBe(true);
      expect(UsersRepository.isValidRole('superadmin')).toBe(false);
    });
  });
});

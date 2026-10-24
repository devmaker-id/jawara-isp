import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/app/modules/auth/auth.service';
import { PasswordService } from '../src/app/modules/auth/password.service';
import type { UsersRepository, UserRecord } from '../src/app/modules/users/users.repository';

const passwords = new PasswordService();

function record(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 1,
    name: 'Administrator',
    email: 'admin@jawara-billing.com',
    password_hash: '$2b$12$hashpalsuuntuktest',
    role: 'admin',
    phone: null,
    address: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    existsByEmail: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    countAll: vi.fn().mockResolvedValue(1),
    countAdmins: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as UsersRepository;
}

function makeService(repo: UsersRepository): AuthService {
  return new AuthService(
    { jwtSecret: 'test-jwt-secret' } as never,
    { sign: () => 'test-token', verifyAsync: async () => ({}) } as never,
    repo,
    passwords,
  );
}

describe('AuthService', () => {
  it('tidak membocorkan password_hash pada respons login', async () => {
    const hash = await passwords.hash('rahasia-uji-123');
    const service = makeService(
      makeRepo({ findByEmail: vi.fn().mockResolvedValue(record({ password_hash: hash })) }),
    );

    const user = await service.validateUser('admin@jawara-billing.com', 'rahasia-uji-123');
    expect(user).not.toBeNull();

    const response = await service.login(user!);
    expect(response.user).not.toHaveProperty('password_hash');
  });

  it('tidak membocorkan password_hash pada getCurrentUser', async () => {
    const service = makeService(makeRepo({ findByEmail: vi.fn().mockResolvedValue(record()) }));

    const user = await service.getCurrentUser('admin@jawara-billing.com');
    expect(user).not.toBeNull();
    expect(user).not.toHaveProperty('password_hash');
  });

  it('mengembalikan null untuk password salah', async () => {
    const hash = await passwords.hash('rahasia-uji-123');
    const service = makeService(
      makeRepo({ findByEmail: vi.fn().mockResolvedValue(record({ password_hash: hash })) }),
    );

    await expect(service.validateUser('admin@jawara-billing.com', 'salah')).resolves.toBeNull();
  });

  it('mengembalikan null untuk akun nonaktif', async () => {
    const hash = await passwords.hash('rahasia-uji-123');
    const service = makeService(
      makeRepo({
        findByEmail: vi.fn().mockResolvedValue(record({ password_hash: hash, is_active: false })),
      }),
    );

    await expect(service.validateUser('admin@jawara-billing.com', 'rahasia-uji-123')).resolves.toBeNull();
  });

  it('memberi 503 saat tabel users kosong, bukan 401', async () => {
    const service = makeService(
      makeRepo({ findByEmail: vi.fn().mockResolvedValue(null), countAll: vi.fn().mockResolvedValue(0) }),
    );

    await expect(service.validateUser('siapa@saja.test', 'apa-saja')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('memberi 503 saat database tidak dapat diakses, bukan 401', async () => {
    const service = makeService(
      makeRepo({
        findByEmail: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      }),
    );

    await expect(service.validateUser('admin@jawara-billing.com', 'apa-saja')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('mengembalikan null (bukan 503) bila email tidak terdaftar namun tabel berisi', async () => {
    const service = makeService(
      makeRepo({ findByEmail: vi.fn().mockResolvedValue(null), countAll: vi.fn().mockResolvedValue(5) }),
    );

    await expect(service.validateUser('tidak-ada@test.local', 'apa-saja')).resolves.toBeNull();
  });

  it('menaikkan hash legacy SHA-256 ke bcrypt setelah login berhasil', async () => {
    const legacy = createHash('sha256').update('password123').digest('hex');
    const update = vi.fn().mockResolvedValue(record());
    const service = makeService(
      makeRepo({
        findByEmail: vi.fn().mockResolvedValue(record({ password_hash: legacy })),
        update,
      }),
    );

    await service.validateUser('admin@jawara-billing.com', 'password123');

    const payload = update.mock.calls[0][1] as { password_hash: string };
    expect(payload.password_hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('gagal rehash tidak menggagalkan login yang sudah valid', async () => {
    const legacy = createHash('sha256').update('password123').digest('hex');
    const service = makeService(
      makeRepo({
        findByEmail: vi.fn().mockResolvedValue(record({ password_hash: legacy })),
        update: vi.fn().mockRejectedValue(Object.assign(new Error('down'), { code: 'ECONNREFUSED' })),
      }),
    );

    await expect(service.validateUser('admin@jawara-billing.com', 'password123')).resolves.not.toBeNull();
  });
});

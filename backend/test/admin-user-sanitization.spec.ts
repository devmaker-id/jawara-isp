import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/app/modules/admin/admin.service';
import { PasswordService } from '../src/app/modules/auth/password.service';
import type { UsersRepository, UserRecord } from '../src/app/modules/users/users.repository';

function record(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 1,
    name: 'Operator Test',
    email: 'operator.test@example.test',
    password_hash: '$2b$12$hashpalsuuntuktest',
    role: 'operator',
    phone: null,
    address: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// Repository di-mock: test tidak menyentuh database.
function makeRepo(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    existsByEmail: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    countAll: vi.fn().mockResolvedValue(0),
    countAdmins: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as UsersRepository;
}

describe('AdminService', () => {
  it('tidak membocorkan password_hash saat membuat atau mendaftar user', async () => {
    const repo = makeRepo({
      create: vi.fn().mockResolvedValue(record({ id: 7 })),
      findAll: vi.fn().mockResolvedValue([record({ id: 7 })]),
    });
    const service = new AdminService(new PasswordService(), repo);

    const created = await service.create({
      name: 'Operator Test',
      email: 'operator.test@example.test',
      password: 'rahasia-uji-123',
      role: 'operator',
    });
    const listed = await service.findAll();

    expect(created).not.toHaveProperty('password_hash');
    expect(listed[0]).not.toHaveProperty('password_hash');
  });

  it('mengirim password ke repository dalam bentuk hash bcrypt', async () => {
    const create = vi.fn().mockResolvedValue(record({ id: 8 }));
    const service = new AdminService(new PasswordService(), makeRepo({ create }));

    await service.create({
      name: 'Hash Test',
      email: 'hash.test@example.test',
      password: 'rahasia-uji-123',
      role: 'operator',
    });

    const payload = create.mock.calls[0][0] as { password_hash: string };
    expect(payload.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(payload.password_hash).not.toContain('rahasia-uji-123');
  });

  it('menolak email duplikat dengan ConflictException', async () => {
    const service = new AdminService(
      new PasswordService(),
      makeRepo({ existsByEmail: vi.fn().mockResolvedValue(true) }),
    );

    await expect(
      service.create({
        name: 'Dup',
        email: 'dup@example.test',
        password: 'rahasia-uji-123',
        role: 'operator',
      }),
    ).rejects.toThrow(/Email sudah terdaftar/);
  });

  it('menerjemahkan ER_DUP_ENTRY menjadi ConflictException', async () => {
    const service = new AdminService(
      new PasswordService(),
      makeRepo({
        create: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })),
      }),
    );

    await expect(
      service.create({
        name: 'Dup',
        email: 'dup@example.test',
        password: 'rahasia-uji-123',
        role: 'operator',
      }),
    ).rejects.toThrow(/Email sudah terdaftar/);
  });

  it('melempar NotFound saat user tidak ada', async () => {
    const service = new AdminService(new PasswordService(), makeRepo());

    await expect(service.findOne(99)).rejects.toThrow(/tidak ditemukan/);
    await expect(service.remove(99)).rejects.toThrow(/tidak ditemukan/);
  });

  it('update tanpa password tidak menulis ulang password_hash', async () => {
    const update = vi.fn().mockResolvedValue(record({ name: 'Nama Baru' }));
    const service = new AdminService(
      new PasswordService(),
      makeRepo({ findById: vi.fn().mockResolvedValue(record()), update }),
    );

    await service.update(1, { name: 'Nama Baru' });

    const payload = update.mock.calls[0][1] as { password_hash?: string };
    expect(payload.password_hash).toBeUndefined();
  });
});

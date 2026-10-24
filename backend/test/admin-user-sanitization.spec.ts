import { describe, expect, it } from 'vitest';
import { AdminService } from '../src/app/modules/admin/admin.service';
import { PasswordService } from '../src/app/modules/auth/password.service';

describe('AdminService public user responses', () => {
  it('does not expose password_hash when creating or listing users', async () => {
    const service = new AdminService(new PasswordService());
    const created = await service.create({
      name: 'Operator Test',
      email: 'operator.test@example.test',
      password: 'rahasia-uji-123',
      role: 'operator',
    });

    expect(created).not.toHaveProperty('password_hash');
    expect(service.findAll()[0]).not.toHaveProperty('password_hash');
  });

  it('menyimpan password sebagai bcrypt, bukan nilai mentah', async () => {
    const service = new AdminService(new PasswordService());
    await service.create({
      name: 'Hash Test',
      email: 'hash.test@example.test',
      password: 'rahasia-uji-123',
      role: 'operator',
    });

    const stored = service.findByEmail('hash.test@example.test');
    expect(stored?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(stored?.password_hash).not.toContain('rahasia-uji-123');
  });

  it('menolak email duplikat dengan ConflictException', async () => {
    const service = new AdminService(new PasswordService());
    const dto = {
      name: 'Dup',
      email: 'dup@example.test',
      password: 'rahasia-uji-123',
      role: 'operator' as const,
    };
    await service.create(dto);
    await expect(service.create(dto)).rejects.toThrow(/Email sudah terdaftar/);
  });
});

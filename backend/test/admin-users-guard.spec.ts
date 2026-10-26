import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminService } from '../src/app/modules/admin/admin.service';
import { PasswordService } from '../src/app/modules/auth/password.service';
import { UsersRepository } from '../src/app/modules/users/users.repository';
import { createFakeUsers, FakeUsers } from './helpers/fake-users';

// Aturan pengamanan akun diuji langsung di service: aturan "admin aktif
// terakhir" tidak dapat dipicu lewat HTTP karena aktor yang sah selalu admin
// aktif lain, sehingga target bukan admin terakhir.
describe('AdminService — pengamanan akun', () => {
  let fake: FakeUsers;
  let service: AdminService;

  const admin = (id = 1) => fake.accounts.get(id)!;

  beforeAll(async () => {
    fake = await createFakeUsers();
    service = new AdminService(new PasswordService(), fake.repo as UsersRepository);
  });

  it('menolak menonaktifkan admin aktif terakhir', async () => {
    fake.accounts.set(1, { ...admin(1), role: 'admin', is_active: true });
    // Aktor fiktif (bukan pemanggil admin) agar aturan "terakhir" tercapai.
    await expect(service.update(1, { is_active: false }, 999)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('menolak menurunkan role admin aktif terakhir', async () => {
    await expect(service.update(1, { role: 'operator' }, 999)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('mengizinkan penonaktifan bila masih ada admin aktif lain', async () => {
    fake.accounts.set(50, { ...admin(1), id: 50, email: 'admin2@uji.test', role: 'admin' });
    const res = await service.update(1, { is_active: false }, 50);
    expect(res.is_active).toBe(false);
    fake.accounts.set(1, { ...admin(1), is_active: true });
    fake.accounts.delete(50);
  });

  it('menolak perubahan role akun sendiri', async () => {
    await expect(service.update(1, { role: 'operator' }, 1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('menolak penghapusan akun sendiri', async () => {
    await expect(service.remove(1, 1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('menolak penghapusan admin aktif terakhir', async () => {
    await expect(service.remove(1, 999)).rejects.toBeInstanceOf(ConflictException);
  });

  it('menolak penghapusan akun yang punya jejak audit/transaksi', async () => {
    const target = admin(3);
    fake.references.set(target.id, 1);
    await expect(service.remove(target.id, 1)).rejects.toBeInstanceOf(ConflictException);
    fake.references.delete(target.id);
  });

  it('mengembalikan password_hash hanya sebagai hash dan tidak pernah plaintext', async () => {
    const created = await service.create({
      name: 'Uji Hash',
      email: 'hash@uji.test',
      password: 'rahasia12345',
      role: 'operator',
    });
    expect(created).not.toHaveProperty('password_hash');
    const stored = [...fake.accounts.values()].find((u) => u.email === 'hash@uji.test')!;
    expect(stored.password_hash).not.toBe('rahasia12345');
    expect(stored.password_hash.startsWith('$2')).toBe(true);
  });

  it('daftar tanpa page tetap array, dengan page dipaginasi', async () => {
    const plain = await service.list({});
    expect(Array.isArray(plain)).toBe(true);

    const paged = await service.list({ page: 1, limit: 2 });
    expect(Array.isArray(paged)).toBe(false);
    expect(paged).toMatchObject({ page: 1, limit: 2 });
    expect((paged as { rows: unknown[] }).rows).toHaveLength(2);
  });
});
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/app/modules/auth/password.service';

const passwords = new PasswordService();

describe('PasswordService', () => {
  it('menghasilkan bcrypt cost 12', async () => {
    const hash = await passwords.hash('rahasia-uji-123');

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).toHaveLength(60);
  });

  it('memberi hash berbeda untuk password sama (salt acak)', async () => {
    const [a, b] = await Promise.all([
      passwords.hash('rahasia-uji-123'),
      passwords.hash('rahasia-uji-123'),
    ]);

    expect(a).not.toBe(b);
  });

  it('memverifikasi password benar dan menolak yang salah', async () => {
    const hash = await passwords.hash('rahasia-uji-123');

    await expect(passwords.verify('rahasia-uji-123', hash)).resolves.toEqual({
      ok: true,
      needsRehash: false,
    });
    await expect(passwords.verify('salah-sekali', hash)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('memverifikasi hash SHA-256 legacy dan menandainya perlu rehash', async () => {
    const legacy = createHash('sha256').update('password123').digest('hex');

    await expect(passwords.verify('password123', legacy)).resolves.toEqual({
      ok: true,
      needsRehash: true,
    });
    await expect(passwords.verify('password1234', legacy)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('tidak pernah membuat hash SHA-256 baru', async () => {
    const hash = await passwords.hash('apa-saja-123');

    expect(passwords.isLegacyHash(hash)).toBe(false);
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('menandai hash bcrypt dengan cost rendah untuk dinaikkan', async () => {
    const bcrypt = await import('bcryptjs');
    const weak = bcrypt.hashSync('rahasia-uji-123', 10);

    await expect(passwords.verify('rahasia-uji-123', weak)).resolves.toEqual({
      ok: true,
      needsRehash: true,
    });
  });

  it('menolak hash kosong atau format tak dikenal', async () => {
    await expect(passwords.verify('apa-saja', '')).resolves.toEqual({ ok: false, needsRehash: false });
    await expect(passwords.verify('apa-saja', 'bukan-hash')).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });
});

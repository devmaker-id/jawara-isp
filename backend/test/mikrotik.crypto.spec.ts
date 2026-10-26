import { describe, expect, it } from 'vitest';
import {
  SecretCryptoError,
  decryptSecret,
  encryptSecret,
  isEncrypted,
} from '../src/app/modules/mikrotik/crypto';

// Kredensial perangkat disimpan terenkripsi AES-256-GCM: tes ini memastikan
// roundtrip, ketahanan terhadap kunci salah, dan kompatibilitas nilai lama.
const KEY = 'kunci-tes-crypto-32-karakter-panjang';

describe('crypto kredensial perangkat', () => {
  it('mengenkripsi lalu mendekripsi kembali tanpa kehilangan karakter', () => {
    const plain = 'P@ssw0rd!#%&*()_+ dengan spasi';
    const stored = encryptSecret(plain, KEY);

    expect(stored).not.toContain(plain);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored.split(':')).toHaveLength(4);
    expect(decryptSecret(stored, KEY)).toBe(plain);
  });

  it('menghasilkan ciphertext berbeda untuk plaintext sama (IV acak)', () => {
    const a = encryptSecret('rahasia', KEY);
    const b = encryptSecret('rahasia', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('rahasia');
    expect(decryptSecret(b, KEY)).toBe('rahasia');
  });

  it('membiarkan nilai lama tanpa prefix v1 apa adanya', () => {
    expect(decryptSecret('password-lama', KEY)).toBe('password-lama');
    expect(isEncrypted('password-lama')).toBe(false);
  });

  it('string kosong menghasilkan string kosong', () => {
    expect(encryptSecret('', KEY)).toBe('');
    expect(decryptSecret('', KEY)).toBe('');
    expect(decryptSecret(null, KEY)).toBe('');
  });

  it('menolak dekripsi dengan kunci berbeda dan memberi pesan yang bisa dibaca', () => {
    const stored = encryptSecret('rahasia', KEY);
    expect(() => decryptSecret(stored, 'kunci-lain-yang-berbeda')).toThrow(SecretCryptoError);
    try {
      decryptSecret(stored, 'kunci-lain-yang-berbeda');
    } catch (error) {
      expect((error as Error).message).toMatch(/tidak dapat didekripsi/i);
      expect((error as Error).message).toMatch(/SECRET_KEY/i);
    }
  });

  it('menolak ciphertext yang diubah (autentikasi GCM gagal)', () => {
    const stored = encryptSecret('rahasia', KEY);
    const parts = stored.split(':');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('palsu').toString('base64')].join(':');
    expect(() => decryptSecret(tampered, KEY)).toThrow(SecretCryptoError);
  });

  it('menolak enkripsi tanpa SECRET_KEY dengan pesan jelas', () => {
    expect(() => encryptSecret('rahasia', '')).toThrow(/SECRET_KEY belum diisi/i);
  });

  it('menolak format tersimpan yang tidak dikenali', () => {
    expect(() => decryptSecret('v1:hanya-dua-bagian', KEY)).toThrow(/tidak dikenali/i);
  });
});
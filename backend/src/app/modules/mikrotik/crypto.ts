import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// =====================================================================
// Enkripsi kredensial perangkat di database.
//
// Password API MikroTik tidak boleh tersimpan sebagai teks biasa: dump
// database, backup, atau akses baca SQL akan langsung membocorkan kredensial
// semua router. Format nilai tersimpan:
//
//   v1:<iv-base64>:<tag-base64>:<ciphertext-base64>     (AES-256-GCM)
//
// Kunci diturunkan dari SECRET_KEY milik aplikasi + label tetap. Nilai lama
// yang belum terenkripsi (mis. hasil seed migrasi) tetap bisa dibaca: fungsi
// dekripsi mengembalikan apa adanya bila prefix "v1:" tidak ada.
// =====================================================================

const PREFIX = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

export const isEncrypted = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.startsWith(`${PREFIX}:`);

const deriveKey = (keyMaterial: string): Buffer => {
  if (!keyMaterial || keyMaterial.trim().length === 0) {
    throw new SecretCryptoError(
      'SECRET_KEY belum diisi sehingga kredensial perangkat tidak bisa dienkripsi.',
    );
  }
  // sha256 memberi panjang 32 byte yang dibutuhkan AES-256.
  return createHash('sha256').update(`${keyMaterial}:mikrotik-devices`).digest();
};

export function encryptSecret(plain: string, keyMaterial: string): string {
  if (plain === '') return '';
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(stored: string | null | undefined, keyMaterial: string): string {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored; // nilai lama / seed migrasi
  const parts = stored.split(':');
  if (parts.length !== 4) {
    throw new SecretCryptoError('Format kredensial tersimpan tidak dikenali.');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveKey(keyMaterial),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch (error) {
    if (error instanceof SecretCryptoError) throw error;
    // GCM gagal autentikasi = kunci berubah atau data diubah.
    throw new SecretCryptoError(
      'Kredensial perangkat tidak dapat didekripsi (SECRET_KEY berubah atau data rusak). Isi ulang password perangkat.',
    );
  }
}
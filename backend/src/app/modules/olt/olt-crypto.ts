import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Enkripsi kredensial OLT di database.
 *
 * Sama seperti kredensial MikroTik: password perangkat tidak boleh tersimpan
 * sebagai teks biasa, karena dump database atau akses baca SQL akan langsung
 * membocorkan kredensial semua OLT.
 *
 * Format nilai tersimpan:
 *
 *   v1:<iv-base64>:<tag-base64>:<ciphertext-base64>     (AES-256-GCM)
 *
 * Kunci diturunkan dari SECRET_KEY aplikasi + label tetap yang BERBEDA dari
 * label MikroTik, supaya satu kunci tidak bisa dipakai silang antar modul.
 */
const PREFIX = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export class OltSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OltSecretError';
  }
}

const deriveKey = (keyMaterial: string): Buffer => {
  if (!keyMaterial || keyMaterial.trim().length === 0) {
    throw new OltSecretError(
      'SECRET_KEY belum diisi sehingga kredensial OLT tidak bisa dienkripsi.',
    );
  }
  return createHash('sha256').update(`${keyMaterial}:olt-devices`).digest();
};

export function encryptOltSecret(plain: string, keyMaterial: string): string {
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

export function decryptOltSecret(stored: string | null | undefined, keyMaterial: string): string {
  if (!stored) return '';
  if (!stored.startsWith(`${PREFIX}:`)) return stored;
  const parts = stored.split(':');
  if (parts.length !== 4) {
    throw new OltSecretError('Format kredensial OLT tersimpan tidak dikenali.');
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
    if (error instanceof OltSecretError) throw error;
    throw new OltSecretError(
      'Kredensial OLT tidak dapat didekripsi (SECRET_KEY berubah atau data rusak). Isi ulang password perangkat.',
    );
  }
}
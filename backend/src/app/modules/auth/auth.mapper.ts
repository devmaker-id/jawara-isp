import { ServiceUnavailableException } from '@nestjs/common';
import { UserRecord } from '../users/users.repository';

// Kode error MySQL yang berarti infrastruktur bermasalah, bukan kredensial salah.
const DB_DOWN_CODES = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ENOTFOUND',
  'ER_BAD_DB_ERROR',
  'ER_NO_SUCH_TABLE',
  'POOL_CLOSED',
];

export function isDatabaseFailure(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' && DB_DOWN_CODES.includes(code);
}

// Autentikasi gagal secara aman: 503, bukan 401. Frontend tidak menghapus sesi
// pada 503, sehingga gangguan database tidak mengeluarkan semua pengguna.
export function toAuthFailure(error: unknown): never {
  if (isDatabaseFailure(error)) {
    throw new ServiceUnavailableException(
      'Layanan autentikasi sedang tidak tersedia. Coba lagi beberapa saat lagi.',
    );
  }
  throw error;
}

export function toPublicUser(user: UserRecord) {
  const { password_hash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export type PublicUser = ReturnType<typeof toPublicUser>;

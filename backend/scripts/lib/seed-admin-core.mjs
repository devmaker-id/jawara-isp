// Logika murni untuk seed admin, dipisah dari CLI agar bisa diuji tanpa
// database dan tanpa TTY.
import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 12;

// Password yang terlalu umum ditolak walau panjangnya memenuhi syarat.
const WEAK_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'administrator',
  'qwertyuiop123',
  '123456789012',
  'jawara123456',
  'bibitnet1234',
  'adminadmin12',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function validateEmail(email) {
  if (typeof email !== 'string' || email.trim().length === 0) {
    return { ok: false, message: 'Email wajib diisi.' };
  }
  if (email.length > 100) {
    return { ok: false, message: 'Email maksimal 100 karakter.' };
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, message: 'Format email tidak valid.' };
  }
  return { ok: true };
}

/**
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function validateName(name) {
  if (typeof name !== 'string' || name.trim().length < 2) {
    return { ok: false, message: 'Nama minimal 2 karakter.' };
  }
  if (name.length > 100) {
    return { ok: false, message: 'Nama maksimal 100 karakter.' };
  }
  return { ok: true };
}

/**
 * Kebijakan password: minimal 12 karakter, tidak boleh sama dengan email,
 * tidak boleh nilai umum, dan tidak boleh hanya satu jenis karakter.
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function validatePassword(password, { email = '' } = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, message: 'Password wajib diisi.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password minimal ${MIN_PASSWORD_LENGTH} karakter.` };
  }
  if (password.length > 200) {
    return { ok: false, message: 'Password maksimal 200 karakter.' };
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, message: 'Password terlalu umum, gunakan kombinasi lain.' };
  }
  if (email && password.toLowerCase().includes(email.toLowerCase().split('@')[0])) {
    return { ok: false, message: 'Password tidak boleh memuat bagian dari email.' };
  }

  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (kinds < 2) {
    return { ok: false, message: 'Password harus memuat minimal 2 jenis karakter (huruf besar/kecil, angka, simbol).' };
  }

  return { ok: true };
}

export function confirmPassword(password, confirmation) {
  if (password !== confirmation) {
    return { ok: false, message: 'Konfirmasi password tidak cocok.' };
  }
  return { ok: true };
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Memutuskan apakah seed boleh dijalankan berdasarkan isi tabel.
 * @param {{total: number, admins: number}} counts
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function assertSeedable(counts) {
  if (!counts || typeof counts.total !== 'number' || typeof counts.admins !== 'number') {
    return { ok: false, message: 'Status tabel users tidak dapat dibaca.' };
  }
  if (counts.admins > 0) {
    return {
      ok: false,
      message: `Sudah ada ${counts.admins} akun admin. Seed dibatalkan agar tidak menimpa akun yang ada.`,
    };
  }
  if (counts.total > 0) {
    return {
      ok: false,
      message: `Tabel users sudah berisi ${counts.total} baris tanpa admin. Periksa manual sebelum menambah admin.`,
    };
  }
  return { ok: true };
}

/**
 * Menerjemahkan error MySQL menjadi pesan yang bisa dibaca manusia.
 */
export function describeDbError(error) {
  const code = error && error.code;
  switch (code) {
    case 'ER_DUP_ENTRY':
      return 'Email sudah terdaftar. Tidak ada data yang ditulis.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'Akses database ditolak. Periksa DB_USER/DB_PASSWORD pada backend/.env.';
    case 'ECONNREFUSED':
      return 'Database tidak dapat dihubungi (koneksi ditolak). Pastikan MySQL berjalan.';
    case 'ENOTFOUND':
      return 'Host database tidak ditemukan. Periksa DB_HOST.';
    case 'ETIMEDOUT':
      return 'Koneksi database timeout. Periksa jaringan atau beban server.';
    case 'ER_NO_SUCH_TABLE':
      return 'Tabel users tidak ada. Jalankan schema.sql terlebih dahulu.';
    case 'ER_BAD_DB_ERROR':
      return 'Database tidak ditemukan. Periksa DB_NAME.';
    default:
      return `Kegagalan database${code ? ` (${code})` : ''}. Tidak ada data yang ditulis.`;
  }
}

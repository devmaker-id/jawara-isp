// Model tabel `mikrotik_devices` (migrasi 005_mikrotik_devices.sql).
//
// Satu-satunya tempat definisi kontrak database untuk perangkat MikroTik.
// Aturan yang dijaga di sini:
//   * Nama kolom & tipe mengikuti migrations/005_mikrotik_devices.sql apa adanya
//     (snake_case, TINYINT(1) untuk flag).
//   * Baris mentah (`MikrotikDeviceRow`) adalah bentuk yang dikembalikan
//     mysql2; angka 0/1 belum dinormalisasi.
//   * Model domain (`MikrotikDevice`) memakai konvensi panel: flag boolean,
//     timestamp ISO string. Dipakai lapisan service/controller/UI.
//   * `api_password` TIDAK pernah masuk model domain. UI hanya menerima
//     status password_set / password_encrypted.

export const MIKROTIK_DEVICE_TABLE = 'mikrotik_devices';
export const DEVICES_MIGRATION = '005_mikrotik_devices.sql';
export const DEFAULT_API_PORT = 1998;
// Prefix ciphertext AES-256-GCM yang ditulis crypto.ts.
export const ENCRYPTED_PREFIX = 'v1:';

// Urutan kolom SELECT dipakai repository agar tidak ada drift antar query.
export const MIKROTIK_DEVICE_COLUMNS = [
  'id',
  'name',
  'host',
  'api_port',
  'api_user',
  'api_password',
  'gui_url',
  'description',
  'write_enabled',
  'is_active',
  'last_checked_at',
  'last_connected',
  'last_message',
  'last_identity',
  'created_at',
  'updated_at',
] as const;

export const MIKROTIK_DEVICE_SELECT = MIKROTIK_DEVICE_COLUMNS.join(', ');

/** Baris mentah tabel `mikrotik_devices` seperti dikembalikan mysql2. */
export interface MikrotikDeviceRow {
  id: number;
  name: string;
  host: string;
  api_port: number;
  api_user: string;
  /** Ciphertext `v1:<iv>:<tag>:<data>` atau teks biasa hanya untuk hasil seed. */
  api_password: string;
  gui_url: string | null;
  description: string | null;
  write_enabled: number;
  is_active: number;
  last_checked_at: Date | string | null;
  last_connected: number | null;
  last_message: string | null;
  last_identity: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Data yang boleh ditulis lewat repository (password sudah dienkripsi). */
export interface DeviceWriteData {
  name: string;
  host: string;
  api_port: number;
  api_user: string;
  api_password?: string;
  gui_url?: string | null;
  description?: string | null;
  write_enabled?: boolean;
  is_active?: boolean;
}

/** Model domain yang aman dikirim ke browser. */
export interface MikrotikDevice {
  id: number;
  name: string;
  host: string;
  api_port: number;
  api_user: string;
  gui_url: string | null;
  description: string | null;
  write_enabled: boolean;
  is_active: boolean;
  /** true bila api_password terisi. Nilai password tidak pernah dikirim. */
  password_set: boolean;
  /** true bila api_password berupa ciphertext (bukan teks biasa hasil seed). */
  password_encrypted: boolean;
  last_checked_at: string | null;
  last_connected: boolean | null;
  last_message: string | null;
  last_identity: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// TINYINT(1): mysql2 memberi 1/0 (atau true/false bila opsi driver berubah).
function toFlag(value: number | boolean | null | undefined): boolean {
  return Number(value) === 1 || value === true;
}

function toNullableFlag(value: number | boolean | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return toFlag(value);
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Baris database → model domain. Tidak menyertakan api_password. */
export function toMikrotikDevice(row: MikrotikDeviceRow): MikrotikDevice {
  const password = row.api_password ?? '';
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    api_port: Number(row.api_port),
    api_user: row.api_user,
    gui_url: row.gui_url,
    description: row.description,
    write_enabled: toFlag(row.write_enabled),
    is_active: toFlag(row.is_active),
    password_set: password.length > 0,
    password_encrypted: password.startsWith(ENCRYPTED_PREFIX),
    last_checked_at: toIsoString(row.last_checked_at),
    last_connected: toNullableFlag(row.last_connected),
    last_message: row.last_message,
    last_identity: row.last_identity,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

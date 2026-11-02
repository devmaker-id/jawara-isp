import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

// ============================================================================
// Cadangan sebelum NAS RADIUS dihapus.
//
// Menghapus NAS membuang riwayat sesi (radacct) dan log autentikasi
// (radpostauth) yang menunjuk alamatnya. Baris-baris itu disalin dulu ke berkas
// JSON ter-gzip di luar repo, dengan izin 0600 karena berisi secret NAS.
// Penulisan atomik: berkas sementara lalu rename, jadi tidak ada cadangan
// setengah jadi bila proses mati di tengah.
// ============================================================================

const gzipAsync = promisify(gzip);

/** Direktori cadangan; bisa dipindah lewat env RADIUS_BACKUP_DIR. */
export function nasBackupDir(): string {
  return process.env.RADIUS_BACKUP_DIR || join(process.env.HOME || '/tmp', 'backups', 'radius-nas');
}

/** Nama aman untuk dipakai di nama berkas. */
function safeName(value: string): string {
  const cleaned = value.replace(/[^0-9A-Za-z._-]+/g, '_').replace(/^[._]+/, '');
  return cleaned.slice(0, 40) || 'nas';
}

export interface NasBackupFile {
  path: string;
  bytes: number;
}

/**
 * Tulis cadangan; melempar error bila gagal supaya pemanggil membatalkan
 * penghapusan. Tidak ada penghapusan sebelum berkas ini ada di disk.
 */
export async function writeNasBackup(
  payload: Record<string, unknown>,
  nasname: string,
): Promise<NasBackupFile> {
  const dir = nasBackupDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir tidak mengubah izin direktori yang sudah ada — paksa 0700.
  await chmod(dir, 0o700).catch(() => undefined);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `nas-${safeName(nasname)}-${stamp}.json.gz`);
  const body = await gzipAsync(Buffer.from(JSON.stringify(payload, null, 1)));
  await writeFile(`${path}.tmp`, body, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return { path, bytes: body.length };
}
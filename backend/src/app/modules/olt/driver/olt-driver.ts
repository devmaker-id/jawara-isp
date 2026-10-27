/**
 * Kontrak driver OLT.
 *
 * Tujuan kontrak ini: semua vendor menghasilkan bentuk data yang SAMA, sehingga
 * penyimpanan (olt.service) tidak pernah tahu perangkatnya HIOSO, VSOL, atau
 * merek lain. Perbedaan cara memanggil perintah dan membaca outputnya berhenti
 * di dalam driver.
 *
 * Batasan keras: driver hanya membaca. Tidak ada method untuk menulis
 * konfigurasi, menambah ONU, menghapus ONU, menyimpan, atau reboot.
 */

export interface OltConnection {
  vendor: string;
  transport: 'ssh' | 'telnet';
  host: string;
  port: number;
  username: string;
  password: string;
  /** Password untuk masuk mode enable; bila kosong, pakai password login. */
  enablePassword: string | null;
  /** Pola prompt kustom dari data perangkat; kosong = pola bawaan driver. */
  promptPattern: string | null;
}

/** Satu ONU hasil pembacaan status + deskripsi + redaman digabung. */
export interface OltOnu {
  onuId: string;
  portId: string;
  serialNumber: string | null;
  name: string | null;
  description: string | null;
  adminState: string | null;
  omccState: string | null;
  phaseState: string | null;
  online: boolean;
  rxPowerOnu: number | null;
  rxPowerOlt: number | null;
  txPower: number | null;
  temperature: number | null;
  voltage: number | null;
  txBias: number | null;
}

/** Identitas perangkat yang bisa dibaca tanpa mengubah apa pun. */
export interface OltIdentity {
  prompt: string | null;
  version: string | null;
}

export interface OltAdapter {
  /** Buka sesi sampai siap menerima perintah untuk port PON tertentu. */
  open(): Promise<OltIdentity>;
  /** Baca seluruh ONU pada satu port PON (mis. "0/1"). */
  readOnus(portId: string): Promise<OltOnu[]>;
  /** Tutup sesi. Wajib dipanggil di blok `finally` pemanggil. */
  close(): Promise<void>;
}

/** Factory driver: dipilih dari kolom `vendor` perangkat. */
export type OltAdapterFactory = (connection: OltConnection) => OltAdapter;

export class OltDriverUnsupportedError extends Error {
  constructor(vendor: string) {
    super(
      `Driver OLT "${vendor}" belum tersedia di panel. Driver yang terdaftar: ` +
        'vsol. Tambahkan driver baru di src/app/modules/olt/vendors/.',
    );
    this.name = 'OltDriverUnsupportedError';
  }
}

/** Angka dari teks perangkat; "-" atau kosong berarti tidak ada nilai. */
export const toNumber = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
};
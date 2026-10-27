import { toNumber } from '../../driver/olt-driver';

/**
 * Parser keluaran CLI VSOL / GLOBAL GPON (GPON OLT Platform V1.1.9).
 *
 * Fungsi murni: masuk teks, keluar data. Tidak ada koneksi, tidak ada Prisma,
 * sehingga bisa diuji dengan fixture keluaran perangkat asli.
 *
 * Kenapa tidak regex "pintar": `show onu state` mengirim kolom yang MENEMPEL
 * tanpa spasi (`1:1enableenableworkingZICG295ebcf2`), dan tiap kolom punya
 * panjang berbeda. Pemisahan dilakukan bertahap — status admin/omcc dulu
 * (kata tetap), lalu sisa baris dibelah menjadi phase + serial.
 */

export interface VsolOnuState {
  onuId: string;
  portIndex: string;
  adminState: string;
  omccState: string;
  phaseState: string;
  serialNumber: string | null;
  online: boolean;
}

export interface VsolOnuOptical {
  onuId: string;
  rxPowerOnu: number | null;
  rxPowerOlt: number | null;
  txPower: number | null;
  temperature: number | null;
  voltage: number | null;
  txBias: number | null;
}

/** Baris yang bukan data ONU: echo perintah, prompt, ringkasan, pesan galat. */
const isNoise = (line: string): boolean => {
  const text = line.trim();
  if (text === '') return true;
  if (/^[A-Za-z0-9._-]+(?:\([^)]*\))?[>#]$/.test(text)) return true; // prompt
  if (/^show\s+onu/i.test(text)) return true; // echo perintah
  if (/^total\s*:/i.test(text)) return true;
  if (/unknown command|invalid|error|please|permission/i.test(text)) return true;
  return false;
};

/**
 * `show onu state` → satu baris per ONU.
 *
 * Contoh nyata:
 *   1:1enableenableworkingZICG295ebcf2
 *   total: 16 working: 16
 */
export const parseOnuState = (raw: string): VsolOnuState[] => {
  const rows: VsolOnuState[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    if (isNoise(line)) continue;
    // Spasi di antara kolom dibuang lebih dulu: sebagian versi firmware
    // mengirim kolom terpisah spasi, sebagian menempel. Setelah ini keduanya
    // punya bentuk yang sama.
    const compact = line.replace(/\s+/g, '');
    const match = /^(\d+):(\d+)(enable|disable)(enable|disable)(.+)$/i.exec(compact);
    if (!match) continue;

    // Format `S:N...`: angka pertama penanda urutan/port di dalam PON (selalu
    // sama untuk satu PON), angka kedua adalah ONU ID. Terbukti dari keluaran
    // asli: 1:1, 1:2, 1:3 ... — yang berubah hanya angka kedua.
    const [, portIndex, onuId, adminState, omccState, rest] = match;

    // Sisa baris = phase + serial. Serial dikenali dari empat huruf BESAR
    // berurutan (kode vendor: ZICG, ZTEG, HWTC, ...), sehingga "working" yang
    // huruf kecil tidak ikut termakan.
    const serialMatch = /([A-Z]{4}[0-9A-Za-z]{4,})$/.exec(rest);
    const serialNumber = serialMatch ? serialMatch[1] : null;
    const phaseState = (serialMatch ? rest.slice(0, serialMatch.index) : rest).toLowerCase();

    rows.push({
      onuId,
      portIndex,
      adminState: adminState.toLowerCase(),
      omccState: omccState.toLowerCase(),
      phaseState,
      serialNumber,
      // ONU dianggap online bila admin enable dan phase-nya working.
      online: adminState.toLowerCase() === 'enable' && phaseState === 'working',
    });
  }

  return rows;
};

/** `show onu desc` → peta onuId → deskripsi. */
export const parseOnuDesc = (raw: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const line of raw.split(/[\r\n]+/)) {
    if (isNoise(line)) continue;
    const match = /^onu\s+(\d+)\s+desc(?:ription)?\s*:\s*(.*)$/i.exec(line.trim());
    if (!match) continue;
    map.set(match[1], match[2].trim());
  }
  return map;
};

/** Kunci baris optical dinormalkan agar tahan beda spasi/tanda kurung. */
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * `show onu optical-info` → satu blok per ONU.
 *
 *   ONU ID                     : 1
 *   Rx optical level(ONU)      : -9.53
 *   Rx optical level(OLT)      : -16.18
 *   Tx optical level           : 1.91
 *   Power feed voltage         : 3.26(V)
 *   Laser bias current         : 14.550(mA)
 *   Temperature                : 50.277(C)
 */
export const parseOnuOptical = (raw: string): VsolOnuOptical[] => {
  const rows: VsolOnuOptical[] = [];
  let current: VsolOnuOptical | null = null;

  const push = () => {
    if (current) rows.push(current);
  };

  for (const line of raw.split(/[\r\n]+/)) {
    const text = line.trim();
    if (text === '') continue;
    if (/^(show|total|unknown|invalid|error)/i.test(text)) continue;

    const parts = /^([^:]+):(.*)$/.exec(text);
    if (!parts) continue;
    const key = normalizeKey(parts[1]);
    const value = parts[2].trim();

    if (key === 'onuid') {
      push();
      current = {
        onuId: value.replace(/\s+/g, ''),
        rxPowerOnu: null,
        rxPowerOlt: null,
        txPower: null,
        temperature: null,
        voltage: null,
        txBias: null,
      };
      continue;
    }

    if (!current) continue;
    if (key === 'rxopticallevelonu') current.rxPowerOnu = toNumber(value);
    else if (key === 'rxopticallevelolt') current.rxPowerOlt = toNumber(value);
    else if (key === 'txopticallevel') current.txPower = toNumber(value);
    else if (key === 'temperature') current.temperature = toNumber(value);
    else if (key === 'powerfeedvoltage') current.voltage = toNumber(value);
    else if (key === 'laserbiascurrent') current.txBias = toNumber(value);
  }

  push();
  return rows;
};
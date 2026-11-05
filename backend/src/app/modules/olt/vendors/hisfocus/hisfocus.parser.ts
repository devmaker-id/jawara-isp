import { toNumber, ConnectionState } from '../../driver/olt-driver';

/**
 * Parser keluaran CLI HiFocus / Hioso (EPON, software V2.2.67).
 *
 * Bentuk keluaran berbeda dari VSOL:
 *  - tabel berkolom rata dengan spasi, nama pelanggan di kolom terakhir dan
 *    boleh mengandung spasi tunggal ("Noval - NUNGGUL"),
 *  - identitas ONU berupa MAC address, bukan serial GPON,
 *  - redaman dibaca per ONU (`show onu optical-ddm epon <port> <id>`).
 */

export interface HisfocusOnuRow {
  portId: string;
  onuId: string;
  onuMac: string | null;
  adminState: string | null;
  omccState: string | null;
  phaseState: string | null;
  connectionState: ConnectionState | null;
  online: boolean;
  name: string | null;
}

/** Baris tabel: `0/1:1  a4:f3:3b:61:77:bb Up 101 9127 1 3 1 CtcNegDone 30 Yes 7D7H29M10S Noval - NUNGGUL` */
const ROW =
  /^(\d+\/\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;

/** Baris header, garis pemisah, prompt, dan echo perintah. */
const isNoise = (line: string): boolean => {
  const text = line.trim();
  if (text === '') return true;
  if (/^[A-Za-z0-9._-]+[>#]$/.test(text)) return true;
  if (/^show\s+/i.test(text)) return true;
  if (/^onuid\b/i.test(text)) return true;
  if (/^=+$/.test(text)) return true;
  if (/invalid|incomplete|error|unknown|permission|denied/i.test(text)) return true;
  return false;
};

const isMac = (value: string): boolean => /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(value);

/**
 * `ctcStatus` (kolom 10) menjelaskan SEBAB offline, bukan status link.
 *   CtcNegDone  = online
 *   MpcpDiscovery = ONU mati listrik (power off)
 *   --          = fiber putus / LOS
 *   CtcInfo     = autentikasi gagal
 * Status link diambil dari kolom `status` (Up/Down), bukan dari sini.
 */
const mapCtcState = (ctcStatus: string): ConnectionState | null => {
  const s = (ctcStatus ?? '').trim().toLowerCase();
  if (s.startsWith('ctcnegdone')) return 'ONLINE';
  if (s.includes('mpcp') || s.includes('discovery')) return 'ONU_POWER_OFF';
  if (s === '--') return 'FIBER_LOS';
  if (s.startsWith('ctcinfo')) return 'ONU_AUTH_FAILED';
  return 'UNKNOWN';
};

/**
 * `show onu info epon 0/1 all` → daftar ONU.
 *
 * Kolom: OnuId MacAddress Status Firmware ChipId Ge Fe Pots CtcStatus CtcVer
 *        Activate Uptime Name
 *
 * Status "Up" = link hidup. Kolom CtcStatus (CtcNegDone) BUKAN status link,
 * jadi tidak dipakai untuk menentukan online.
 */
export const parseOnuTable = (raw: string): HisfocusOnuRow[] => {
  const rows: HisfocusOnuRow[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    if (isNoise(line)) continue;
    const match = ROW.exec(line.trim());
    if (!match) continue;

    const [, portId, onuId, mac, status, , , , , , ctcStatus, , activate, uptime, name] = match;
    const statusLower = status.toLowerCase();

    rows.push({
      portId,
      onuId,
      onuMac: isMac(mac) ? mac.toLowerCase() : null,
      // Tiga nilai yang dipakai UI, disamakan artinya dengan driver VSOL.
      adminState: activate.toLowerCase() === 'yes' ? 'enable' : 'disable',
      omccState: ctcStatus.toLowerCase().startsWith('ctcnegdone') ? 'enable' : 'disable',
      phaseState: statusLower,
      connectionState: mapCtcState(ctcStatus),
      online: statusLower === 'up',
      name: (name ?? '').trim() || null,
    });

    void uptime;
  }

  return rows;
};

export interface HisfocusOptical {
  rxPowerOnu: number | null;
  rxPowerOlt: number | null;
  txPower: number | null;
  temperature: number | null;
  voltage: number | null;
  txBias: number | null;
}

/**
 * `show onu optical-ddm epon 0/1 1` → satu blok:
 *
 *   Temperature  : 53.00 C
 *   Voltage      : 3.00  V
 *   TxBias       : 17.00 mA
 *   TxPower      : 2.40 dBm
 *   RxPower      : -12.24 dBm
 *
 * Perangkat EPON ini tidak memberi Rx sisi OLT per ONU, jadi rxPowerOlt null.
 */
export const parseOptical = (raw: string): HisfocusOptical | null => {
  const values = new Map<string, number>();
  for (const line of raw.split(/[\r\n]+/)) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (!match) continue;
    const value = toNumber(match[2]);
    if (value !== null) values.set(match[1].toLowerCase(), value);
  }

  const rx = values.get('rxpower');
  if (rx === undefined && values.size === 0) return null;

  return {
    rxPowerOnu: rx ?? null,
    rxPowerOlt: null,
    txPower: values.get('txpower') ?? null,
    temperature: values.get('temperature') ?? null,
    voltage: values.get('voltage') ?? null,
    txBias: values.get('txbias') ?? null,
  };
};

/** `show system` → nama dan versi perangkat untuk status koneksi. */
export const parseSystem = (raw: string): { identity: string | null; version: string | null } => {
  const pick = (pattern: RegExp): string | null => {
    const match = pattern.exec(raw);
    return match ? match[1].trim() : null;
  };
  return {
    identity: pick(/^\s*Name\s*:\s*(.+)$/m),
    version: pick(/^\s*Software\s*:\s*(.+)$/m),
  };
};

/**
 * `show onu info epon <port> <id>` (detail satu ONU) → nilai `ctc_autoneg`.
 *
 * Perangkat menulis field ini sebagai `Ctc autoneg` (spasi) — bukan underscore.
 * Regex dibuat toleran spasi/underscore/hubung supaya tahan beda firmware.
 * Nilai sama dengan kolom `CtcStatus` pada `... all`:
 *   CtcNegDone (online), MpcpDiscovery (listrik), -- (fiber), CtcInfo (auth).
 */
export const parseOnuInfoCtc = (raw: string): ConnectionState | null => {
  const match = /^\s*ctc[\s_-]*autoneg\s*:\s*(.+?)\s*$/im.exec(raw);
  if (!match) return null;
  return mapCtcState(match[1]);
};
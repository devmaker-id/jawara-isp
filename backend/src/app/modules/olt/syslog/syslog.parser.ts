/**
 * Parser syslog OLT → event kanonik.
 *
 * Format yang dikenali:
 *
 *   HiFocus/Hioso (terverifikasi) :
 *     <30>Jun 24 01:53:09 OLT_BIBITNET: [2026-06-24 01:53:09] ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkup
 *     <30>Jun 24 01:52:01 OLT_BIBITNET: User admin login from CLI 172.10.0.247
 *
 *   VSOL/GLOBAL (terverifikasi — OLT Muncang) :
 *     <27>Nov  5 17:51:06 gpon-olt auditd[0]: ONU Online  PON 0/1 ONU 12 sn ZTEGcbb6bd02 .
 *     <27>Nov  5 17:51:06 gpon-olt auditd[0]: ONU Dying Gasp  PON 0/1 ONU 8 sn ZTEGcc5c3bd5 .
 *     <27>Nov  5 17:50:53 gpon-olt auditd[0]: ONU Port Los  PON 0/1 ONU 8 sn ZTEGcc5c3bd5  LAN2 LINK DOWN.
 */

import { ConnectionState } from '../driver/olt-driver';

export type SyslogEventType =
  | 'ONU_LINKUP'
  | 'ONU_LINKDOWN'
  | 'ONU_REGISTER'
  | 'ONU_DEREGISTER'
  | 'ONU_DYING_GASP'
  | 'LOGIN'
  | 'LOGOUT'
  | 'UNKNOWN';

export interface ParsedSyslogEvent {
  oltName: string | null;
  eventType: SyslogEventType;
  portId: string | null;
  onuId: string | null;
  onuMac: string | null;
  onuName: string | null;
  /** Nomor seri ONU (untuk VSOL/Global) — dipakai sebagai penanda ketika MAC/nama tidak ada. */
  onuSerial: string | null;
  /** Klasifikasi penyebab non-online. Akurat hanya untuk VSOL (dari teks event). */
  connectionState: ConnectionState | null;
}

const OLT_NAME = /\s([\w][\w.-]*):\s/;

/** Baris ONU HiFocus: `ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkup` */
const HIFOCUS_ONU =
  /ONU\s+(\d+\/\d+):(\d+)\s+\[\s*([0-9A-Fa-f:]{17})\s*\]\s*\[([^\]]*)\]\s*(linkup|linkdown|register|unregister|deregister|dying.?gasp)/i;

const HIFOCUS_ONU_NAMED = /ONU\s+(\d+\/\d+):(\d+)\s+\[\s*([0-9A-Fa-f:]{17})\s*\](?:.*?)?\s*(linkup|linkdown|register|unregister|deregister)/i;

const LOGIN_RE = /User\s+(\w+)\s+(login|logout)\s+from\s+(CLI|Web)\s+([0-9.]+)/i;

/**
 * VSOL/Global: `ONU <NamaEvent>  PON <port> ONU <id> sn <serial> ...`
 * Nama event dipisah spasi (Online, Offline, Dying Gasp, Port Los, Register, …).
 */
const VSOL_ONU =
  /ONU\s+([A-Za-z][A-Za-z ]*?)\s+PON\s+(\d+\/\d+)\s+ONU\s+(\d+)\s+sn\s+([A-Za-z0-9]+)/i;

function mapStatus(word: string): SyslogEventType {
  const s = word.toLowerCase();
  if (s.includes('linkup')) return 'ONU_LINKUP';
  if (s.includes('linkdown') || s.includes('link-lost') || s.includes('los')) return 'ONU_LINKDOWN';
  if (s.includes('dying')) return 'ONU_DYING_GASP';
  if (s.includes('deregister') || s.includes('unregister')) return 'ONU_DEREGISTER';
  if (s.includes('register')) return 'ONU_REGISTER';
  return 'UNKNOWN';
}

/** Status kata kunci HiFocus → klasifikasi penyebab. */
function statusToConnectionState(status: string): ConnectionState {
  const s = status.toLowerCase();
  if (s.includes('dying')) return 'ONU_POWER_OFF';
  if (s.includes('linkup')) return 'ONLINE';
  if (s.includes('deregister') || s.includes('unregister')) return 'OFFLINE';
  if (s.includes('register')) return 'ONLINE';
  return 'OFFLINE';
}

/** Peta nama event VSOL (bentuk spasi) → tipe + klasifikasi penyebab. */
function mapVsolEvent(
  name: string,
): { eventType: SyslogEventType; connectionState: ConnectionState | null } {
  const n = name.trim().toLowerCase();
  if (n.includes('dying')) return { eventType: 'ONU_DYING_GASP', connectionState: 'ONU_POWER_OFF' };
  if (n.includes('deregister') || n.includes('unregister'))
    return { eventType: 'ONU_DEREGISTER', connectionState: 'OFFLINE' };
  if (n.includes('register')) return { eventType: 'ONU_REGISTER', connectionState: 'ONLINE' };
  if (n.includes('online')) return { eventType: 'ONU_LINKUP', connectionState: 'ONLINE' };
  if (n.includes('offline')) return { eventType: 'ONU_LINKDOWN', connectionState: 'OFFLINE' };
  if (n.includes('los')) return { eventType: 'ONU_LINKDOWN', connectionState: 'FIBER_LOS' };
  return { eventType: 'UNKNOWN', connectionState: null };
}

export function parseSyslogEvent(raw: string): ParsedSyslogEvent {
  const text = raw.replace(/\r/g, '').trim();
  const nameMatch = OLT_NAME.exec(text);
  const oltName = nameMatch ? nameMatch[1] : null;

  // 1) ONU HiFocus berstruktur
  const onu = HIFOCUS_ONU.exec(text) || HIFOCUS_ONU_NAMED.exec(text);
  if (onu) {
    const [, portId, onuId, mac, onuName, status] = onu;
    return {
      oltName,
      eventType: status.toLowerCase().includes('linkup') ? 'ONU_LINKUP' : status.toLowerCase().includes('linkdown') ? 'ONU_LINKDOWN' : mapStatus(status),
      portId,
      onuId,
      onuMac: mac.trim().toUpperCase(),
      onuName: (onuName || '').trim() || null,
      onuSerial: null,
      connectionState: statusToConnectionState(status),
    };
  }

  // 2) login/logout
  const login = LOGIN_RE.exec(text);
  if (login) {
    return {
      oltName,
      eventType: login[2].toLowerCase() === 'login' ? 'LOGIN' : 'LOGOUT',
      portId: null,
      onuId: null,
      onuMac: null,
      onuName: login[1],
      onuSerial: null,
      connectionState: null,
    };
  }

  // 3) VSOL/Global
  const vsol = VSOL_ONU.exec(text);
  if (vsol) {
    const [, eventName, portId, onuId, serial] = vsol;
    const mapped = mapVsolEvent(eventName);
    return {
      oltName,
      eventType: mapped.eventType,
      connectionState: mapped.connectionState,
      portId,
      onuId,
      onuMac: null,
      onuName: null,
      onuSerial: serial,
    };
  }

  return {
    oltName,
    eventType: 'UNKNOWN',
    portId: null,
    onuId: null,
    onuMac: null,
    onuName: null,
    onuSerial: null,
    connectionState: null,
  };
}
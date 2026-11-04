/**
 * Parser syslog OLT → event kanonik.
 *
 * Format yang dikenali:
 *
 *   HiFocus/Hioso (terverifikasi) :
 *     <30>Jun 24 01:53:09 OLT_BIBITNET: [2026-06-24 01:53:09] ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkup
 *     <30>Jun 24 01:52:01 OLT_BIBITNET: User admin login from CLI 172.10.0.247
 *
 *   VSOL/GLOBAL (best-effort, disempurnakan setelah tangkapan pertama) :
 *     ONU_REGISTER / ONU_DEREGISTER / ONU Port Los PON 0/1 ONU 5 sn ...
 */

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
}

const OLT_NAME = /\s([\w][\w.-]*):\s/;

/** Baris ONU HiFocus: `ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkup` */
const HIFOCUS_ONU =
  /ONU\s+(\d+\/\d+):(\d+)\s+\[\s*([0-9A-Fa-f:]{17})\s*\]\s*\[([^\]]*)\]\s*(linkup|linkdown|register|unregister|deregister|dying.?gasp)/i;

const HIFOCUS_ONU_NAMED = /ONU\s+(\d+\/\d+):(\d+)\s+\[\s*([0-9A-Fa-f:]{17})\s*\](?:.*?)?\s*(linkup|linkdown|register|unregister|deregister)/i;

const LOGIN_RE = /User\s+(\w+)\s+(login|logout)\s+from\s+(CLI|Web)\s+([0-9.]+)/i;

/** VSOL: `ONU Port Los  PON 0/1 ONU 5 sn ZTEGcc4382c5` atau token ONU_REGISTER dsb. */
const VSOL_PON = /PON\s+(\d+\/\d+)\s+ONU\s+(\d+)/i;
const VSOL_EVENT = /\b(ONU_REGISTER|ONU_DEREGISTER|ONU_DYING_GASP|ONU_LINK_LOST|ONU_LOS|ONU_AUTH_FAILED)\b/i;

function mapStatus(word: string): SyslogEventType {
  const s = word.toLowerCase();
  if (s.includes('linkup')) return 'ONU_LINKUP';
  if (s.includes('linkdown') || s.includes('link-lost') || s.includes('los')) return 'ONU_LINKDOWN';
  if (s.includes('dying')) return 'ONU_DYING_GASP';
  if (s.includes('deregister') || s.includes('unregister')) return 'ONU_DEREGISTER';
  if (s.includes('register')) return 'ONU_REGISTER';
  return 'UNKNOWN';
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
    };
  }

  // 3) VSOL best-effort
  const vsolEvent = VSOL_EVENT.exec(text);
  const pon = VSOL_PON.exec(text);
  if (vsolEvent) {
    const kind = vsolEvent[1].toUpperCase();
    let type: SyslogEventType = 'UNKNOWN';
    if (kind === 'ONU_REGISTER') type = 'ONU_REGISTER';
    else if (kind === 'ONU_DEREGISTER' || kind === 'ONU_LINK_LOST') type = 'ONU_DEREGISTER';
    else if (kind === 'ONU_DYING_GASP') type = 'ONU_DYING_GASP';
    else if (kind === 'ONU_LOS') type = 'ONU_LINKDOWN';
    return {
      oltName,
      eventType: type,
      portId: pon ? pon[1] : null,
      onuId: pon ? pon[2] : null,
      onuMac: null,
      onuName: null,
    };
  }

  return { oltName, eventType: 'UNKNOWN', portId: null, onuId: null, onuMac: null, onuName: null };
}
import { OltSyslogDriver, SyslogClientState, SyslogClientTarget } from './olt-syslog-driver';
import { OltConnection } from '../driver/olt-driver';

/**
 * Driver Syslog Client HiFocus / Hioso (EPON) lewat WEB GUI (HTTP :80),
 * BUKAN lewat CLI telnet.
 *
 * Alasan: command CLI `syslog server <ip>` memicu restart daemon syslog yang
 * pada firmware ini menjadi REBOOT OLT. Web GUI memakai handler goform yang
 * memperbarui target syslog secara graceful, tanpa reboot:
 *
 *   baca  : GET /logServer.asp                       → `syslogInfo = new Array("<ip>")`
 *   set   : GET /goform/setSyslogServ?logServ_ip=<ip>
 *   simpan: GET /goform/saveConfiguration
 *
 * Autentikasi HTTP Basic — kredensial SAMA dengan telnet (username/password
 * perangkat, sudah didekripsi dari olt_devices oleh pemanggil).
 */

const WEB_PORT = 80;
const DISABLED_IP = '0.0.0.0';
const FETCH_TIMEOUT_MS = 20_000;

/** Ambil IP syslog dari halaman `logServer.asp` (`syslogInfo = new Array("…")`). */
export function parseLogServerIp(html: string): string | null {
  const match = html.match(/syslogInfo\s*=\s*new\s+Array\s*\(\s*"([^"]*)"\s*\)/i);
  return match ? match[1] : null;
}

export class HisfocusSyslogDriver implements OltSyslogDriver {
  private readonly baseUrl: string;
  private readonly auth: string;

  constructor(connection: OltConnection) {
    this.baseUrl = `http://${connection.host}:${WEB_PORT}`;
    this.auth = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`;
  }

  async read(): Promise<SyslogClientState> {
    const html = await this.request('/logServer.asp');
    const ip = parseLogServerIp(html);
    const enabled = ip !== null && ip !== '' && ip !== DISABLED_IP;
    return {
      enabled,
      collectorIp: enabled ? ip : null,
      collectorPort: 514,
      readBack: html.slice(0, 2000),
    };
  }

  async apply(target: SyslogClientTarget): Promise<SyslogClientState> {
    const ip = target.enabled ? target.collectorIp : DISABLED_IP;
    await this.request(`/goform/setSyslogServ?logServ_ip=${encodeURIComponent(ip)}`);
    await this.request('/goform/saveConfiguration');
    return this.read();
  }

  async close(): Promise<void> {
    // HTTP stateless — tidak ada sesi yang perlu ditutup.
  }

  private async request(path: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: this.auth },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Web GUI OLT menjawab ${response.status}: ${text.slice(0, 160)}`);
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Web GUI OLT tidak menjawab dalam ${FETCH_TIMEOUT_MS / 1000} detik.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
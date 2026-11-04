import {
  OltSyslogDriver,
  SyslogClientState,
  SyslogClientTarget,
  openSyslogSession,
} from './olt-syslog-driver';
import { PromptShell } from '../transport/prompt-shell';
import { OltConnection } from '../driver/olt-driver';

/**
 * Driver Syslog Client VSOL / GLOBAL GPON.
 *
 * Sintaks terverifikasi di perangkat (Phase 0, Platform V1.1.9):
 *
 *   syslog server ip <A.B.C.D> port <PORT>   tujuan syslog (config mode)
 *   event <name> remote enable|disable
 *   alarm <name> remote enable|disable
 *   save                                    simpan ke flash
 *
 * Baca status: `show logging` (Syslog logging per daemon) + `show running-config`
 * (baris `syslog server ip <ip> port <port>` dan `event/alarm ... remote enable`).
 *
 * Catatan: pager VSOL rusak (`sh: more: not found`) sehingga `show running-config`
 * bisa terpotong; read-back terbaik untuk status daemon adalah `show logging`.
 */

const SAVE = 'save';
const DEFAULT_PORT = 514;

/** Event/alarm ONU yang diarahkan ke remote secara bawaan (monitoring + alert). */
export const DEFAULT_VSOL_EVENT_SPECS = [
  'event onu-register',
  'event onu-auth-success',
  'event onu-finish',
  'event onu-link-discover',
  'alarm onu-deregister',
  'alarm onu-link-lost',
  'alarm onu-dying-gasp',
  'alarm onu-auth-failed',
] as const;

/** Baris perintah untuk menerapkan target (dipisah agar mudah diuji). */
export function vsolApplyCommands(target: SyslogClientTarget): string[] {
  const mode = target.enabled ? 'enable' : 'disable';
  const port = target.collectorPort ?? DEFAULT_PORT;
  const ip = target.enabled ? target.collectorIp : '0.0.0.0';
  const commands = ['configure', `syslog server ip ${ip} port ${port}`];
  const specs =
    target.events && target.events.length > 0 ? target.events : [...DEFAULT_VSOL_EVENT_SPECS];
  for (const spec of specs) commands.push(`${spec} remote ${mode}`);
  commands.push(SAVE);
  return commands;
}

/** true bila `show logging` melaporkan syslog aktif untuk salah satu daemon. */
export function parseVsolLogging(output: string): boolean {
  return /\bSyslog logging:\s*enabled/i.test(output);
}

/** Ambil IP dari `syslog server ip <ip> port <port>` di `show running-config`. */
export function parseVsolRemoteIp(output: string): string | null {
  const match = output.match(/syslog\s+server\s+ip\s+([\d.]+)\s+port\s+\d+/i);
  return match ? match[1] : null;
}

export function parseVsolEvents(output: string): string[] {
  const specs: string[] = [];
  const re = /^\s*(event|alarm)\s+([\w-]+)\s+remote\s+enable\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) specs.push(`${m[1]} ${m[2]}`);
  return specs;
}

export class VsolSyslogDriver implements OltSyslogDriver {
  private shell: PromptShell | null = null;

  constructor(private readonly connection: OltConnection) {}

  private async ready(): Promise<PromptShell> {
    this.shell ??= await openSyslogSession(this.connection);
    return this.shell;
  }

  async read(): Promise<SyslogClientState> {
    const shell = await this.ready();
    const logging = await shell.run('show logging', 30_000);
    const running = await shell.run('show running-config', 30_000).catch(() => '');
    const ip = parseVsolRemoteIp(running);
    const enabled = parseVsolLogging(logging) || (ip !== null && ip !== '0.0.0.0');
    return {
      enabled,
      collectorIp: ip,
      collectorPort: 514,
      readBack: [logging, running].join('\n').slice(0, 3000),
    };
  }

  async apply(target: SyslogClientTarget): Promise<SyslogClientState> {
    const shell = await this.ready();
    for (const command of vsolApplyCommands(target)) {
      await shell.run(command, 20_000);
    }
    return this.read();
  }

  async close(): Promise<void> {
    const shell = this.shell;
    this.shell = null;
    if (shell) await shell.close().catch(() => undefined);
  }
}
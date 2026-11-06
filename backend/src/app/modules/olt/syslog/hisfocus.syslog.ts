import {
  OltSyslogDriver,
  SyslogClientState,
  SyslogClientTarget,
  openSyslogSession,
} from './olt-syslog-driver';
import { PromptShell } from '../transport/prompt-shell';
import { OltConnection } from '../driver/olt-driver';

/**
 * Driver Syslog Client HiFocus / Hioso (EPON).
 *
 * Sintaks terverifikasi di perangkat (Phase 0, V2.2.67 & V2.2.84):
 *
 *   baca  : show running-config   → baris `syslog server <ip>`
 *   set   : configure terminal → syslog server <ip>
 *   simpan: wr          (tulis config ke flash; perintah penuh `write` me-reboot OLT)
 *
 * Hanya IP tujuan yang dapat diatur — tidak ada port/protocol/severity.
 * Port tetap UDP/514. Disable dilakukan dengan `syslog server 0.0.0.0`.
 *
 * Catatan perilaku perangkat: mengirim `syslog server 0.0.0.0` membuat sesi
 * CLI terputus (daemon syslog di-restart). Karena itu disable diterapkan dengan
 * urutan: kirim perintah (sesi mungkin putus) → buka sesi baru → `wr`.
 */

// Simpan config ke flash. Wajib `wr`, BUKAN `write`: perintah penuh `write`
// pada HiFocus/Hioso membuat layar blank dan me-reboot perangkat. Singkatan
// `wr` aman dan mengembalikan "Configuration file saved ok!".
const WRITE = 'wr';

/** Baris perintah untuk menerapkan target (dipisah agar mudah diuji). */
export function hisfocusApplyCommands(target: SyslogClientTarget): string[] {
  const ip = target.enabled ? target.collectorIp : '0.0.0.0';
  return ['configure terminal', `syslog server ${ip}`, WRITE];
}

/** Parse `show running-config` menjadi status syslog. */
export function parseHisfocusRunningConfig(output: string): {
  enabled: boolean;
  collectorIp: string | null;
} {
  const match = output.match(/syslog\s+server\s+([\d.]+)/i);
  if (!match) return { enabled: false, collectorIp: null };
  const ip = match[1];
  return { enabled: ip !== '0.0.0.0', collectorIp: ip };
}

/** Jalankan urutan perintah dan kembalikan output tiap langkah (untuk read-back). */
async function runSequence(shell: PromptShell, commands: string[]): Promise<string> {
  const outputs: string[] = [];
  for (const command of commands) {
    const out = await shell.run(command, 20_000);
    outputs.push(out);
  }
  return outputs.join('\n');
}

export class HisfocusSyslogDriver implements OltSyslogDriver {
  private shell: PromptShell | null = null;

  constructor(private readonly connection: OltConnection) {}

  private get ready(): PromptShell {
    if (!this.shell) throw new Error('Sesi syslog OLT belum dibuka.');
    return this.shell;
  }

  async read(): Promise<SyslogClientState> {
    const shell = (this.shell ??= await openSyslogSession(this.connection));
    const raw = await shell.run('show running-config', 30_000);
    const parsed = parseHisfocusRunningConfig(raw);
    return {
      enabled: parsed.enabled,
      collectorIp: parsed.collectorIp,
      collectorPort: 514,
      readBack: raw.slice(0, 2000),
    };
  }

  async apply(target: SyslogClientTarget): Promise<SyslogClientState> {
    const shell = (this.shell ??= await openSyslogSession(this.connection));
    const commands = hisfocusApplyCommands(target);

    if (!target.enabled) {
      // Disable: perintah set-0.0.0.0 diproses lalu sesi bisa terputus. Kirim
      // dengan toleransi putus, buka sesi baru, lalu simpan.
      try {
        await runSequence(shell, commands.slice(0, 2));
      } catch {
        // sesi putus setelah perintah pertama — wajar, lanjut ke sesi baru.
      }
      await shell.close().catch(() => undefined);
      this.shell = null;
      const fresh = (this.shell = await openSyslogSession(this.connection));
      await fresh.run(WRITE, 20_000);
    } else {
      await runSequence(shell, commands);
    }

    return this.read();
  }

  async close(): Promise<void> {
    const shell = this.shell;
    this.shell = null;
    if (shell) await shell.close().catch(() => undefined);
  }
}
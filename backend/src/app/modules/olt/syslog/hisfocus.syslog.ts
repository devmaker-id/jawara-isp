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
 * Sintaks terverifikasi:
 *
 *   baca  : show running-config
 *   set   : configure terminal
 *           syslog server <ip>
 *   simpan: session.writeFile()
 *
 * Port tetap UDP/514.
 * Disable menggunakan syslog server 0.0.0.0.
 *
 * Catatan:
 * Perintah disable dapat menyebabkan sesi CLI terputus
 * karena daemon syslog mengalami restart.
 */

const DISABLED_IP = '0.0.0.0';

/** Menghasilkan command konfigurasi (keluar dari config mode sebelum simpan). */
export function hisfocusApplyCommands(target: SyslogClientTarget): string[] {
  const ip = target.enabled ? target.collectorIp : DISABLED_IP;

  // `exit` meninggalkan config mode ke privileged supaya `writeFile()` (wr)
  // dikirim dari mode yang benar — mengetik simpan dari dalam config mode
  // inilah yang membuat perangkat blank/reboot.
  return ['configure terminal', `syslog server ${ip}`, 'exit'];
}

/** Parse konfigurasi syslog dari running-config. */
export function parseHisfocusRunningConfig(output: string): {
  enabled: boolean;
  collectorIp: string | null;
} {
  const match = output.match(/syslog\s+server\s+([\d.]+)/i);

  if (!match) {
    return {
      enabled: false,
      collectorIp: null,
    };
  }

  const ip = match[1];

  return {
    enabled: ip !== DISABLED_IP,
    collectorIp: ip,
  };
}

/** Menjalankan urutan command CLI. */
async function runSequence(shell: PromptShell, commands: string[]): Promise<string> {
  const outputs: string[] = [];

  for (const command of commands) {
    const output = await shell.run(command, 20_000);
    outputs.push(output);
  }

  return outputs.join('\n');
}

export class HisfocusSyslogDriver implements OltSyslogDriver {
  private shell: PromptShell | null = null;

  constructor(private readonly connection: OltConnection) {}

  private async getSession(): Promise<PromptShell> {
    if (!this.shell) {
      this.shell = await openSyslogSession(this.connection);
    }

    return this.shell;
  }

  /** Membaca konfigurasi syslog. */
  async read(): Promise<SyslogClientState> {
    const shell = await this.getSession();

    const raw = await shell.run('show running-config', 30_000);

    const parsed = parseHisfocusRunningConfig(raw);

    return {
      enabled: parsed.enabled,
      collectorIp: parsed.collectorIp,
      collectorPort: 514,
      readBack: raw.slice(0, 2000),
    };
  }

  /** Menerapkan dan menyimpan konfigurasi syslog. */
  async apply(target: SyslogClientTarget): Promise<SyslogClientState> {
    const shell = await this.getSession();
    const commands = hisfocusApplyCommands(target);

    if (target.enabled) {
      // Enable: konfigurasi → simpan.
      await runSequence(shell, commands);
      await shell.writeFile();
    } else {
      // Disable: konfigurasi dapat menyebabkan sesi terputus.
      try {
        await runSequence(shell, commands);
      } catch {
        // Kemungkinan sesi terputus akibat restart daemon syslog.
      }

      // Tutup sesi lama dan buat koneksi baru.
      await shell.close().catch(() => undefined);
      this.shell = null;

      const fresh = await this.getSession();

      // Simpan melalui mekanisme session, bukan command CLI.
      await fresh.writeFile();
    }

    // Baca ulang konfigurasi untuk memastikan hasil penerapan.
    return this.read();
  }

  /** Menutup koneksi CLI. */
  async close(): Promise<void> {
    const shell = this.shell;
    this.shell = null;

    if (shell) {
      await shell.close().catch(() => undefined);
    }
  }
}
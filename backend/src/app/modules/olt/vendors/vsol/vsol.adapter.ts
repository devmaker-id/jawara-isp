import {
  OltAdapter,
  OltConnection,
  OltIdentity,
  OltOnu,
} from '../../driver/olt-driver';
import { PromptShell } from '../../transport/prompt-shell';
import { loginHandshake } from '../../transport/login';
import { connectSsh } from '../../transport/ssh.transport';
import { connectTelnet } from '../../transport/telnet.transport';
import { parseOnuDesc, parseOnuOptical, parseOnuState } from './vsol.parser';

/**
 * Driver VSOL / GLOBAL GPON (GPON OLT Platform V1.1.9).
 *
 * Alur sesi yang harus diikuti perangkat ini — tidak bisa disingkat:
 *
 *   login → prompt `OLT-MUNCANG>` → enable (minta password) → `#`
 *          → configure → `(config)#`
 *          → interface gpon 0/1 → `(config-pon-0/1)#`
 *          → show onu state / desc / optical-info
 *
 * `show onu ...` hanya ada di sub-mode PON. Di mode enable perangkat menjawab
 * "unknown command", jadi salah mode = data kosong tanpa pesan galat.
 *
 * Semua perintah di sini READ-ONLY. Tidak ada `onu add`, `no onu`, `save`,
 * atau `reboot` di driver mana pun.
 */
export class VsolAdapter implements OltAdapter {
  private shell: PromptShell | null = null;
  private mode: 'shell' | 'enable' | 'config' | 'pon' = 'shell';
  private currentPort: string | null = null;
  /** Baris prompt terakhir, mis. "OLT-MUNCANG". Dipakai sebagai identitas. */
  private promptName: string | null = null;

  constructor(private readonly connection: OltConnection) {}

  async open(): Promise<OltIdentity> {
    const options = {
      host: this.connection.host,
      port: this.connection.port,
      username: this.connection.username,
      password: this.connection.password,
      promptPattern: this.connection.promptPattern,
    };

    this.shell =
      this.connection.transport === 'telnet'
        ? await connectTelnet(options)
        : await connectSsh(options);

    // Perangkat ini punya login interaktif di dalam shell (bukan hanya di
    // transport), jadi username/password dikirim di sini bila ditanyakan.
    const banner = await loginHandshake(this.shell, {
      username: this.connection.username,
      password: this.connection.password,
    });
    this.promptName = /([A-Za-z0-9._-]+)[>#]\s*$/.exec(banner.trim())?.[1] ?? null;

    await this.enterEnable();

    return { prompt: this.promptName, version: null };
  }

  private get shellReady(): PromptShell {
    if (!this.shell) throw new Error('Sesi OLT belum dibuka.');
    return this.shell;
  }

  /** `enable` bisa langsung berhasil atau meminta password. */
  private async enterEnable(): Promise<void> {
    const shell = this.shellReady;
    shell.send('enable');
    const output = await shell
      .waitFor(/(?:#\s*$|assword\s*[:]?\s*$)/i, 10_000, 'enable')
      .catch(() => '');

    if (/assword/i.test(output)) {
      const secret = this.connection.enablePassword || this.connection.password;
      if (!secret) {
        throw new Error(
          'Perangkat meminta password enable, tetapi password enable belum diisi pada data perangkat.',
        );
      }
      shell.send(secret);
      await shell.waitFor(/#\s*$/, 10_000, 'enable password');
    }

    this.mode = 'enable';
  }

  async readOnus(portId: string): Promise<OltOnu[]> {
    const shell = this.shellReady;

    // Pindah port: keluar dulu dari sub-mode PON sebelumnya.
    if (this.mode === 'pon' && this.currentPort !== portId) {
      await shell.run('exit');
      this.mode = 'config';
      this.currentPort = null;
    }

    if (this.mode !== 'pon') {
      if (this.mode !== 'config') {
        await shell.run('configure');
        this.mode = 'config';
      }
      await shell.run(`interface gpon ${portId}`);
      this.mode = 'pon';
      this.currentPort = portId;
    }

    const state = parseOnuState(await shell.run('show onu state'));
    if (state.length === 0) return [];

    const desc = parseOnuDesc(await shell.run('show onu desc'));
    const optical = parseOnuOptical(await shell.run('show onu optical-info'));
    const opticalById = new Map(optical.map((row) => [row.onuId, row]));

    return state.map((row) => {
      const optic = opticalById.get(row.onuId);
      return {
        onuId: row.onuId,
        portId,
        serialNumber: row.serialNumber,
        name: null,
        description: desc.get(row.onuId) || null,
        adminState: row.adminState,
        omccState: row.omccState,
        phaseState: row.phaseState,
        online: row.online,
        rxPowerOnu: optic?.rxPowerOnu ?? null,
        rxPowerOlt: optic?.rxPowerOlt ?? null,
        txPower: optic?.txPower ?? null,
        temperature: optic?.temperature ?? null,
        voltage: optic?.voltage ?? null,
        txBias: optic?.txBias ?? null,
      };
    });
  }

  async close(): Promise<void> {
    const shell = this.shell;
    this.shell = null;
    this.mode = 'shell';
    this.currentPort = null;
    if (shell) await shell.close().catch(() => undefined);
  }
}
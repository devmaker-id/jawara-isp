import {
  OltAdapter,
  OltConnection,
  OltIdentity,
  OltOnu,
  OltOptical,
} from '../../driver/olt-driver';
import { PromptShell } from '../../transport/prompt-shell';
import { loginHandshake } from '../../transport/login';
import { connectSsh } from '../../transport/ssh.transport';
import { connectTelnet } from '../../transport/telnet.transport';
import { parseOnuTable, parseOptical, parseSystem } from './hisfocus.parser';

/**
 * Driver HiFocus / Hioso (EPON).
 *
 * Urutan sesi (terverifikasi pada OLT nanggela, software V2.2.67):
 *
 *   login (Username: / Password:)
 *     → OLT_BIBITNET>  → enable → OLT_BIBITNET#
 *     → terminal length 512   (matikan pager lebih awal)
 *     → show onu info epon 0/1 all
 *     → show onu optical-ddm epon 0/1 <id>   (satu perintah per ONU)
 *
 * Perintah `show onu ...` tidak dikenal di mode user biasa, jadi `enable`
 * wajib. Semua perintah di sini READ-ONLY.
 *
 * Redaman dibaca per ONU, sehingga `opticalInInventory` sengaja false: service
 * yang menentukan berapa banyak ONU dibaca per sekali jalan, agar satu
 * permintaan tidak menggantung lama untuk OLT dengan ratusan ONU.
 */
export class HisfocusAdapter implements OltAdapter {
  readonly opticalInInventory = false;

  private shell: PromptShell | null = null;
  private enabled = false;
  private ready = false;

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

    // Transport telnet sudah mengirim username/password saat ditanya; SSH bisa
    // meminta login interaktif di dalam shell. Handshake ini menangani keduanya.
    await loginHandshake(this.shell, {
      username: this.connection.username,
      password: this.connection.password,
    });

    await this.enableMode();
    await this.shell.run('terminal length 512', 10_000);

    // Identitas perangkat: nama + versi software. Baca-saja.
    const system = await this.shell.run('show system', 15_000).catch(() => '');
    const info = parseSystem(system);

    this.ready = true;
    return { prompt: info.identity, version: info.version };
  }

  /** Mode privileged. Sebagian perangkat meminta password saat enable. */
  private async enableMode(): Promise<void> {
    if (this.enabled) return;
    const shell = this.shell!;
    shell.send('enable');
    const output = await shell
      .waitFor(/(?:#\s*$|assword\s*[:]?\s*$)/i, 10_000, 'enable')
      .catch(() => '');

    if (/assword\s*:/i.test(output)) {
      const secret = this.connection.enablePassword || this.connection.password;
      shell.send(secret);
      await shell.waitFor(/#\s*$/, 10_000, 'enable password');
    }

    this.enabled = true;
  }

  async readOnus(portId: string): Promise<OltOnu[]> {
    if (!this.ready) throw new Error('Sesi OLT belum dibuka.');
    const shell = this.shell!;

    const raw = await shell.run(`show onu info epon ${portId} all`, 60_000);
    const rows = parseOnuTable(raw);

    return rows.map((row) => ({
      onuId: row.onuId,
      // Perangkat mengirim "0/1:N"; port diambil dari baris itu sendiri supaya
      // tidak ada ketidakcocokan bila daftar port di panel berbeda.
      portId: row.portId,
      serialNumber: null,
      onuMac: row.onuMac,
      name: row.name,
      description: row.name,
      adminState: row.adminState,
      omccState: row.omccState,
      phaseState: row.phaseState,
      online: row.online,
      rxPowerOnu: null,
      rxPowerOlt: null,
      txPower: null,
      temperature: null,
      voltage: null,
      txBias: null,
    }));
  }

  async readOptical(portId: string, onuId: string): Promise<OltOptical | null> {
    if (!this.ready) throw new Error('Sesi OLT belum dibuka.');
    const shell = this.shell!;
    const raw = await shell
      .run(`show onu optical-ddm epon ${portId} ${onuId}`, 15_000)
      .catch(() => '');
    return parseOptical(raw);
  }

  async close(): Promise<void> {
    const shell = this.shell;
    this.shell = null;
    this.ready = false;
    if (shell) await shell.close().catch(() => undefined);
  }
}
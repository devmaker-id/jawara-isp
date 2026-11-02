import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WaWorkerClient } from './wa-worker.client';

const run = promisify(execFile);

/**
 * Command router deterministik.
 *
 * Dipanggil SEBELUM adapter AI. Handler tidak pernah menyentuh model; setiap
 * perintah punya fungsi sendiri, dan perintah baru cukup didaftarkan di
 * `COMMANDS` tanpa mengubah ingest maupun controller.
 */
export interface CommandContext {
  chatId: string;
  chatType: 'dm' | 'group';
  sender: string;
  isAdmin: boolean;
  args: string;
}

export interface CommandResult {
  reply: string;
  /** false = perintah ada tapi tidak boleh dijalankan oleh pengirim ini. */
  ok: boolean;
}

interface CommandDefinition {
  name: string;
  description: string;
  adminOnly: boolean;
  usage: string;
  handler: (ctx: CommandContext) => Promise<CommandResult>;
}

const REPO = process.env.JAWARA_REPO_DIR || '/home/devmaker/jawara-isp';
const NUMBER_RULE = /^[0-9]{4,20}$/;

@Injectable()
export class WaRouterService {
  private readonly logger = new Logger(WaRouterService.name);
  private readonly commands: Map<string, CommandDefinition>;

  constructor(private readonly worker: WaWorkerClient) {
    const definitions: CommandDefinition[] = [
      {
        name: 'help',
        description: 'Daftar perintah yang tersedia',
        adminOnly: false,
        usage: '/help',
        handler: async (ctx) => ({ ok: true, reply: this.helpText(ctx.isAdmin) }),
      },
      {
        name: 'status',
        description: 'Status gateway WhatsApp',
        adminOnly: true,
        usage: '/status',
        handler: async () => ({ ok: true, reply: await this.statusText() }),
      },
      {
        name: 'inet',
        description: 'Cek pelanggan lewat Nomor Internet',
        adminOnly: true,
        usage: '/inet <nomor>',
        handler: async (ctx) => this.lookupCustomer('/inet', ctx),
      },
      {
        name: 'pelanggan',
        description: 'Sama dengan /inet (nama perintah alternatif)',
        adminOnly: true,
        usage: '/pelanggan <nomor>',
        handler: async (ctx) => this.lookupCustomer('/pelanggan', ctx),
      },
    ];
    this.commands = new Map(definitions.map((def) => [def.name, def]));
  }

  /** Nama perintah bila teks dimulai dengan "/", selain itu null. */
  parse(text: string): { name: string; args: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;
    const [head, ...rest] = trimmed.split(/\s+/);
    return { name: head.slice(1).toLowerCase(), args: rest.join(' ').trim() };
  }

  list() {
    return [...this.commands.values()].map(({ name, description, adminOnly, usage }) => ({
      name,
      description,
      admin_only: adminOnly,
      usage,
    }));
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  async execute(name: string, ctx: CommandContext): Promise<CommandResult | null> {
    const command = this.commands.get(name);
    if (!command) return null;
    if (command.adminOnly && !ctx.isAdmin) {
      return { ok: false, reply: 'Perintah ini hanya untuk administrator.' };
    }
    try {
      return await command.handler(ctx);
    } catch (error) {
      this.logger.warn(`Perintah /${name} gagal: ${(error as Error).message}`);
      return { ok: false, reply: 'Perintah gagal dijalankan. Coba lagi beberapa saat lagi.' };
    }
  }

  private helpText(isAdmin: boolean): string {
    const lines = ['*Perintah Jawara-ISP*', ''];
    for (const def of this.commands.values()) {
      if (def.adminOnly && !isAdmin) continue;
      lines.push(`${def.usage} — ${def.description}`);
    }
    lines.push('', 'Perintah tidak dikenal akan dijawab tanpa memanggil AI.');
    return lines.join('\n');
  }

  private async statusText(): Promise<string> {
    try {
      const health = await this.worker.health();
      const connected = health.connected_at ? new Date(health.connected_at) : null;
      return [
        '*Status Gateway WhatsApp*',
        '',
        `Koneksi   : ${health.status}`,
        `Nomor     : ${health.number ?? '—'}`,
        `Tersambung: ${connected ? connected.toLocaleString('id-ID') : '—'}`,
        `Pesan     : masuk ${health.received} · keluar ${health.sent}`,
        `Antrean   : ${health.pending}`,
        `Reconnect : ${health.reconnect_count}`,
        health.last_error ? `Catatan   : ${health.last_error}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } catch {
      return 'Gateway WhatsApp sedang tidak tersedia. Backend billing tetap berjalan.';
    }
  }

  /**
   * /inet dan /pelanggan memakai skrip yang sama dengan panel
   * (`scripts/inet.mjs`) supaya format balasan hanya punya satu sumber.
   */
  private async lookupCustomer(label: string, ctx: CommandContext): Promise<CommandResult> {
    const nomor = ctx.args.split(/\s+/)[0] ?? '';
    if (!nomor) return { ok: false, reply: `Format: ${label} <nomor>\nContoh: ${label} 1312016` };
    if (!NUMBER_RULE.test(nomor)) {
      return { ok: false, reply: `Nomor Internet "${nomor}" tidak sah. Gunakan 4-20 digit angka.` };
    }
    try {
      const { stdout } = await run('node', [`${REPO}/scripts/inet.mjs`, nomor], {
        cwd: REPO,
        timeout: 20_000,
        maxBuffer: 256 * 1024,
      });
      return { ok: true, reply: stdout.trim() || 'Data tidak tersedia.' };
    } catch (error) {
      const out = (error as { stdout?: string }).stdout?.trim();
      return { ok: false, reply: out || 'Panel billing tidak merespons. Coba lagi beberapa saat lagi.' };
    }
  }
}

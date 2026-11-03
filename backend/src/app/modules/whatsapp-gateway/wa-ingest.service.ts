import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { WaRouterService } from './wa-router.service';
import { WaSecurityService } from './wa-security.service';
import { WaWorkerClient, WorkerMessage } from './wa-worker.client';

/**
 * Penarik pesan masuk dari worker WhatsApp.
 *
 * Satu-satunya jalur pemrosesan pesan:
 *   worker → dedup (wa_messages.wa_id UNIQUE) → kebijakan akses → command
 *   router → kirim balasan → catat riwayat.
 *
 * Pesan biasa (bukan perintah) tidak dibalas; gateway ini hanya menjalankan
 * perintah operasional Jawara-ISP.
 */
@Injectable()
export class WaIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaIngestService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  private readonly intervalMs = Number(process.env.WA_POLL_MS || 3000);

  constructor(
    private readonly worker: WaWorkerClient,
    private readonly security: WaSecurityService,
    private readonly router: WaRouterService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Satu putaran: ambil pesan, proses berurutan (tidak paralel per chat). */
  async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const messages = await this.worker.drain();
      for (const message of messages) await this.handle(message);
    } catch {
      // worker mati: bukan urusan tick berikutnya, cukup diamkan
    } finally {
      this.busy = false;
    }
  }

  private async handle(message: WorkerMessage): Promise<void> {
    const preview = message.text.replace(/\s+/g, ' ').slice(0, 200);
    const inserted = await this.db.execute(
      `INSERT IGNORE INTO wa_messages
         (wa_id, direction, chat_id, chat_type, sender, body_preview, processing)
       VALUES (?, 'in', ?, ?, ?, ?, 'ignored')`,
      [message.id || randomUUID(), message.chat_id, message.chat_type, message.sender, preview],
    );
    if (inserted.affectedRows === 0) return; // pesan yang sama sudah pernah diproses

    const parsed = this.router.parse(message.text);
    const check = await this.security.check({
      chatId: message.chat_id,
      chatType: message.chat_type,
      sender: message.sender,
      senderAlt: message.sender_alt,
      text: message.text,
      mentioned: (message as WorkerMessage & { mentioned?: boolean }).mentioned === true,
    });

    if (!check.allowed) {
      await this.finish(message.id, { processing: 'denied', note: check.reason });
      // Balas hanya bila yang dikirim adalah perintah, supaya percakapan asing
      // tidak dibanjiri jawaban otomatis.
      if (parsed) await this.reply(message, 'Anda tidak berwenang menggunakan perintah ini.', 'denied');
      return;
    }

    if (parsed) {
      const result = await this.router.execute(parsed.name, {
        chatId: message.chat_id,
        chatType: message.chat_type,
        sender: message.sender,
        isAdmin: check.isAdmin,
        args: parsed.args,
      });
      if (result) {
        await this.reply(message, result.reply, 'direct');
        await this.finish(message.id, { processing: 'direct', command: parsed.name });
        return;
      }
      // Perintah tak dikenal: dijawab di sini, tanpa AI.
      await this.reply(
        message,
        `Perintah /${parsed.name} tidak dikenal.\nKetik /help untuk daftar perintah.`,
        'direct',
      );
      await this.finish(message.id, { processing: 'ignored', note: 'unknown_command' });
      return;
    }

    // Pesan biasa (bukan perintah): tidak dibalas. Gateway ini hanya menjalankan
    // perintah operasional; tidak ada pemanggilan model bahasa.
    await this.finish(message.id, { processing: 'ignored' });
  }

  private async reply(message: WorkerMessage, text: string, kind: string): Promise<void> {
    let status: 'sent' | 'failed' = 'sent';
    try {
      await this.worker.send(message.chat_id, text);
    } catch (error) {
      status = 'failed';
      this.logger.warn(`Balasan gagal dikirim (${kind}): ${(error as Error).message}`);
    }
    await this.db.execute(
      `INSERT IGNORE INTO wa_messages
         (wa_id, direction, chat_id, chat_type, sender, body_preview, processing, reply_status)
       VALUES (?, 'out', ?, ?, 'bot', ?, 'direct', ?)`,
      [`out:${randomUUID()}`, message.chat_id, message.chat_type, text.replace(/\s+/g, ' ').slice(0, 200), status],
    );
  }

  private async finish(
    waId: string,
    values: { processing: 'direct' | 'ai' | 'ignored' | 'denied' | 'error'; command?: string; note?: string },
  ): Promise<void> {
    await this.db.execute(
      'UPDATE wa_messages SET processing = ?, command = ?, error_note = ? WHERE wa_id = ?',
      [values.processing, values.command ?? null, values.note ?? null, waId],
    );
  }
}

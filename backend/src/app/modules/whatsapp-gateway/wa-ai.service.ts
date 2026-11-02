import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseService } from '../../database/database.service';

const run = promisify(execFile);

/**
 * Adapter AI opsional ke Hermes.
 *
 * Gateway TIDAK bergantung pada Hermes: kalau Hermes mati, method ini
 * mengembalikan null dan pemanggil membalas pesan gangguan. Tidak ada antrean,
 * tidak ada retry panjang — satu percobaan dengan timeout.
 */
@Injectable()
export class WaAiService {
  private readonly logger = new Logger(WaAiService.name);

  constructor(private readonly db: DatabaseService) {}

  private get bin(): string {
    return process.env.HERMES_BIN || '/home/devmaker/.local/bin/hermes';
  }

  private get timeoutMs(): number {
    return Number(process.env.WA_AI_TIMEOUT_MS || 90_000);
  }

  /** Kirim teks ke Hermes dan kembalikan jawabannya; null bila gagal/timeout. */
  async ask(chatId: string, text: string): Promise<string | null> {
    const started = Date.now();
    try {
      const { stdout } = await run(this.bin, ['chat', '-q', text], {
        timeout: this.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HERMES_NO_TUI: '1' },
      });
      const answer = String(stdout || '').trim();
      await this.record(chatId, answer ? 1 : 0, Date.now() - started);
      return answer || null;
    } catch (error) {
      this.logger.warn(`Hermes gagal menjawab: ${(error as Error).message}`);
      await this.record(chatId, 0, Date.now() - started);
      return null;
    }
  }

  private async record(chatId: string, ok: number, durationMs: number): Promise<void> {
    await this.db
      .execute(
        'INSERT INTO wa_ai_usage (chat_id, provider, model, duration_ms, ok) VALUES (?, ?, ?, ?, ?)',
        [chatId, 'hermes', process.env.WA_AI_MODEL || 'hermes-default', durationMs, ok],
      )
      .catch(() => undefined);
  }
}

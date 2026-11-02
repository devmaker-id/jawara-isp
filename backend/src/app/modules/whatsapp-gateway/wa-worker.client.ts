import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Klien HTTP ke WhatsApp worker (proses Node terpisah).
 *
 * Worker memegang satu-satunya sesi WhatsApp; backend tidak pernah menyentuh
 * kredensial. Semua panggilan lewat loopback dengan header `x-wa-token`.
 *
 * Token dibaca dari environment backend (`WA_WORKER_TOKEN`) dan tidak pernah
 * dicetak ke log maupun dikirim ke browser.
 */
export interface WorkerHealth {
  status: 'disconnected' | 'connecting' | 'connected' | 'logged_out';
  number: string | null;
  connected_at: string | null;
  qr_available: boolean;
  reconnect_count: number;
  sent: number;
  received: number;
  pending: number;
  last_error: string | null;
}

export interface WorkerMessage {
  id: string;
  chat_id: string;
  chat_type: 'dm' | 'group';
  sender: string;
  /** Nomor telepon asli bila WhatsApp mengirim LID. */
  sender_alt?: string;
  sender_jid: string;
  text: string;
  at: string;
}

@Injectable()
export class WaWorkerClient {
  private readonly logger = new Logger(WaWorkerClient.name);

  private get base(): string {
    return process.env.WA_WORKER_URL || 'http://127.0.0.1:3199';
  }

  private get token(): string {
    return process.env.WA_WORKER_TOKEN || '';
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) {
      throw new ServiceUnavailableException(
        'Gateway WhatsApp belum dikonfigurasi (WA_WORKER_TOKEN kosong pada backend/.env).',
      );
    }
    try {
      const res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-wa-token': this.token,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(Number(process.env.WA_WORKER_TIMEOUT_MS || 8000)),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ServiceUnavailableException(
          `Worker WhatsApp menolak permintaan (${res.status}): ${body.slice(0, 120)}`,
        );
      }
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`Worker WhatsApp tidak dapat dihubungi: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Worker WhatsApp tidak berjalan. Periksa service jawara-wa di server.',
      );
    }
  }

  health(): Promise<WorkerHealth> {
    return this.call<WorkerHealth>('/health');
  }

  qr(): Promise<{ qr: string | null; at: string | null }> {
    return this.call<{ qr: string | null; at: string | null }>('/qr');
  }

  connect(): Promise<{ ok: boolean; status: string }> {
    return this.call('/connect', { method: 'POST', body: '{}' });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.call('/logout', { method: 'POST', body: '{}' });
  }

  send(to: string, text: string): Promise<{ ok: boolean }> {
    return this.call('/send', { method: 'POST', body: JSON.stringify({ to, text }) });
  }

  async drain(): Promise<WorkerMessage[]> {
    const body = await this.call<{ messages: WorkerMessage[] }>('/messages');
    return body.messages ?? [];
  }
}

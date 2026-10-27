import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

/**
 * Pengirim pesan WhatsApp memakai gateway yang sudah diisi di
 * Pengaturan → WhatsApp Bot.
 *
 * Yang didukung untuk KIRIM DOKUMEN:
 *   fonnte  → multipart `file`, PDF ikut terkirim sebagai dokumen
 *   wablas  → API dokumennya butuh URL publik, bukan unggahan; jadi teks saja
 *   baileys → sesi WhatsApp Web tidak tersedia di server ini; ditolak jelas
 *
 * Tidak ada kredensial yang dicetak ke log.
 */

export interface SendResult {
  ok: boolean;
  provider: string;
  pdf_attached: boolean;
  note?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly settings: SettingsService) {}

  /** Nomor Indonesia: 08xx / 8xx / +62xx → 62xx. */
  static normalisePhone(input: string): string | null {
    const digits = String(input ?? '').replace(/[^\d+]/g, '');
    if (!digits) return null;
    let value = digits.replace(/^\+/, '');
    if (value.startsWith('0')) value = `62${value.slice(1)}`;
    else if (value.startsWith('8')) value = `62${value}`;
    if (!value.startsWith('62') || value.length < 10 || value.length > 15) return null;
    return value;
  }

  private async config(): Promise<{
    enabled: boolean;
    provider: string;
    url: string;
    token: string;
    sender: string;
  }> {
    const [enabled, provider, url, token, sender] = await Promise.all([
      this.settings.rawValue('whatsapp_enabled'),
      this.settings.rawValue('whatsapp_provider'),
      this.settings.rawValue('whatsapp_api_url'),
      this.settings.rawValue('whatsapp_api_token'),
      this.settings.rawValue('whatsapp_sender'),
    ]);
    return {
      enabled: enabled === '1',
      provider: provider.trim().toLowerCase(),
      url: url.trim(),
      token: token.trim(),
      sender: sender.trim(),
    };
  }

  async sendDocument(input: {
    phone: string;
    caption: string;
    filename: string;
    pdf: Buffer;
  }): Promise<SendResult> {
    const config = await this.config();
    const target = WhatsAppService.normalisePhone(input.phone);
    if (!target) {
      throw new BadRequestException(
        `Nomor WhatsApp "${input.phone}" tidak valid. Gunakan format 08xx atau 62xx.`,
      );
    }
    if (!config.enabled) {
      throw new BadRequestException(
        'WhatsApp belum diaktifkan. Buka Pengaturan → WhatsApp Bot, isi provider, URL API, ' +
          'dan token, lalu centang "Aktifkan WhatsApp bot".',
      );
    }
    if (!config.url || !config.token) {
      throw new BadRequestException(
        'URL API dan token WhatsApp belum diisi di Pengaturan → WhatsApp Bot.',
      );
    }
    if (config.provider === 'baileys') {
      throw new BadRequestException(
        'Provider Baileys memakai sesi WhatsApp Web yang tidak berjalan di server panel, ' +
          'sehingga dokumen tidak bisa dikirim. Gunakan Fonnte atau Wablas.',
      );
    }

    if (config.provider === 'fonnte' || config.provider === '') {
      await this.postFonnte(config, target, input);
      return { ok: true, provider: 'fonnte', pdf_attached: true };
    }

    if (config.provider === 'wablas') {
      // API dokumen Wablas menerima URL, bukan unggahan. Mengirim teks lebih
      // jujur daripada mengaku PDF terkirim.
      await this.postWablasText(config, target, input.caption);
      return {
        ok: true,
        provider: 'wablas',
        pdf_attached: false,
        note: 'Wablas hanya menerima tautan dokumen, jadi PDF tidak dilampirkan — teks voucher dikirim.',
      };
    }

    throw new BadRequestException(
      `Provider WhatsApp "${config.provider}" belum didukung. Pilih Fonnte atau Wablas di Pengaturan.`,
    );
  }

  private async postFonnte(
    config: { url: string; token: string },
    target: string,
    input: { caption: string; filename: string; pdf: Buffer },
  ): Promise<void> {
    const form = new FormData();
    form.append('target', target);
    form.append('message', input.caption);
    form.append('filename', input.filename);
    form.append('file', new Blob([new Uint8Array(input.pdf)], { type: 'application/pdf' }), input.filename);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: config.token },
      body: form,
    }).catch((error) => {
      this.logger.warn(`Fonnte tidak dapat dihubungi: ${(error as Error).message}`);
      throw new BadRequestException('Gateway WhatsApp tidak dapat dihubungi. Periksa URL API.');
    });

    const body = await response.text();
    if (!response.ok) {
      this.logger.warn(`Fonnte menolak (${response.status}): ${body.slice(0, 200)}`);
      throw new BadRequestException(
        `Gateway WhatsApp menolak permintaan (HTTP ${response.status}). Periksa token dan kuota.`,
      );
    }
    // Fonnte membalas {"status":false,"reason":"..."} saat gagal.
    try {
      const parsed = JSON.parse(body) as { status?: boolean; reason?: string };
      if (parsed.status === false) {
        throw new BadRequestException(
          `Gateway WhatsApp menolak: ${parsed.reason ?? 'tanpa alasan'}.`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // Balasan bukan JSON: anggap berhasil bila HTTP 2xx.
    }
  }

  private async postWablasText(
    config: { url: string; token: string },
    target: string,
    message: string,
  ): Promise<void> {
    const base = config.url.replace(/\/send-document\/?$/, '/send-message');
    const form = new URLSearchParams({ phone: target, message });
    const response = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: config.token,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    }).catch(() => {
      throw new BadRequestException('Gateway WhatsApp tidak dapat dihubungi. Periksa URL API.');
    });
    if (!response.ok) {
      throw new BadRequestException(
        `Gateway WhatsApp menolak permintaan (HTTP ${response.status}). Periksa token dan kuota.`,
      );
    }
  }
}

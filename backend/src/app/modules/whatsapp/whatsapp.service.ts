import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WaWorkerClient } from '../whatsapp-gateway/wa-worker.client';

/**
 * Pengirim pesan WhatsApp untuk notifikasi panel (mis. voucher ke pelanggan).
 *
 * Satu-satunya jalur sekarang adalah WhatsApp Gateway milik panel
 * (`wa-gateway/worker.js`, sesi Baileys). Pengaturan provider lama
 * (Fonnte/Wablas) sudah dihapus dari halaman Pengaturan karena gateway sudah
 * menangani sesi WhatsApp sendiri.
 *
 * Worker menerima teks (`POST /send`), jadi PDF voucher tidak dilampirkan; isi
 * voucher (profil, username, password) sudah ada di teks pesan. `pdf_attached`
 * dikembalikan false supaya pemanggil tidak mengira dokumen terkirim.
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

  constructor(private readonly worker: WaWorkerClient) {}

  /** Nomor Indonesia: 08xx / 8xx / +62xx -> 62xx. */
  static normalisePhone(input: string): string | null {
    const digits = String(input ?? '').replace(/[^\d+]/g, '');
    if (!digits) return null;
    let value = digits.replace(/^\+/, '');
    if (value.startsWith('0')) value = `62${value.slice(1)}`;
    else if (value.startsWith('8')) value = `62${value}`;
    if (!value.startsWith('62') || value.length < 10 || value.length > 15) return null;
    return value;
  }

  async sendDocument(input: {
    phone: string;
    caption: string;
    filename: string;
    pdf: Buffer;
  }): Promise<SendResult> {
    const target = WhatsAppService.normalisePhone(input.phone);
    if (!target) {
      throw new BadRequestException(
        `Nomor WhatsApp "${input.phone}" tidak valid. Gunakan format 08xx atau 62xx.`,
      );
    }

    try {
      await this.worker.send(target, input.caption);
      return {
        ok: true,
        provider: 'gateway',
        pdf_attached: false,
        note:
          'Terkirim lewat WhatsApp Gateway sebagai teks. PDF tidak dilampirkan karena ' +
          'gateway hanya mengirim pesan teks - username dan password ada di isi pesan.',
      };
    } catch (error) {
      // Worker mati atau sesi belum tersambung: sampaikan apa adanya ke pemanggil.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Gagal mengirim WhatsApp ke ${target}: ${message}`);
      throw new BadRequestException(`Gagal mengirim WhatsApp: ${message}`);
    }
  }
}

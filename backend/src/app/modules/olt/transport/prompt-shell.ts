/**
 * Sesi interaktif berbasis prompt, dipakai bersama oleh transport SSH dan telnet.
 *
 * Perangkat OLT tidak punya API: semuanya dikendalikan dengan mengetik perintah
 * lalu menunggu prompt kembali. Logika "kirim perintah, kumpulkan keluaran,
 * berhenti di prompt" hanya ditulis SEKALI di sini; transport cukup menyediakan
 * kanal teks dua arah.
 */

export interface ShellChannel {
  write(data: string): void;
  close(): void;
  onData(listener: (chunk: string) => void): void;
  onClose(listener: (error?: Error) => void): void;
}

/**
 * Prompt OLT: `OLT-MUNCANG>`, `OLT-MUNCANG#`, `OLT-MUNCANG(config-pon-0/1)#`.
 *
 * Pola ini sengaja menuntut NAMA sebelum tanda > atau #. Tanpa itu, banner
 * sambutan yang penuh garis `#` (kotak ASCII) ikut dianggap prompt, dan sesi
 * berlanjut sebelum perangkat benar-benar siap — gejalanya perintah pertama
 * hilang dan perangkat terus meminta password.
 */
export const DEFAULT_PROMPT = /(?:^|\n)\s*(?:[A-Za-z0-9._-]+(?:\([^)]*\))?[>#]|>)\s*$/;

/** Penanda halaman keluaran panjang — dikirim spasi agar lanjut. */
const MORE_MARKER =
  /--\s?More\s?--|\(q\)\s*uit|Press any key|---?\s*Enter Key To Continue\s*-*/gi;

export class ShellTimeoutError extends Error {
  constructor(command: string, timeoutMs: number, tail: string) {
    super(
      `Perangkat tidak menjawab perintah "${command}" dalam ${Math.round(timeoutMs / 1000)} detik. ` +
        `Keluaran terakhir: ${tail || '(kosong)'}`,
    );
    this.name = 'ShellTimeoutError';
  }
}

export class ShellClosedError extends Error {
  constructor(reason: string) {
    super(`Sesi ke perangkat terputus: ${reason}`);
    this.name = 'ShellClosedError';
  }
}

/**
 * Bersihkan keluaran perangkat sebelum dipakai.
 *
 * Perangkat ini mengirim posisi kolom sebagai escape ANSI (`\x1b[12C`) dan
 * memakai carriage return tunggal sebagai pemisah baris. Tanpa dibersihkan,
 * satu baris data ONU terbaca sebagai teks acak dan parser menganggap tidak ada
 * ONU sama sekali — kegagalan yang tampak seperti "perangkat kosong".
 */
export const sanitizeDeviceOutput = (text: string): string =>
  text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b[()][A-Za-z0-9]/g, '')
    // CR yang berpasangan dengan LF = akhir baris sungguhan.
    .replace(/\r+\n/g, '\n')
    // CR tunggal di perangkat ini berarti "kembali ke kolom 0", bukan baris
    // baru: setelah posisi kolom (escape ANSI) dibuang, kolom-kolom memang
    // MENEMPEL. Menghapusnya memulihkan bentuk asli
    // "1:1enableenableworkingZICG295ebcf2".
    .replace(/\r/g, '');

type Waiter = {
  pattern: RegExp;
  resolve: (buffer: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  command: string;
};

export class PromptShell {
  private buffer = '';
  private waiter: Waiter | null = null;
  private closed: Error | null = null;

  constructor(
    private readonly channel: ShellChannel,
    private readonly prompt: RegExp = DEFAULT_PROMPT,
  ) {
    channel.onData((rawChunk) => {
      const chunk = sanitizeDeviceOutput(rawChunk);
      this.buffer += chunk;
      this.answerPaging();
      this.settle();
    });
    channel.onClose((error) => {
      this.closed = error ?? new ShellClosedError('kanal ditutup perangkat');
      if (this.waiter) {
        clearTimeout(this.waiter.timer);
        this.waiter.reject(this.closed);
        this.waiter = null;
      }
    });
  }

  /** Kirim satu baris perintah. Selalu diakhiri CRLF seperti terminal. */
  send(line: string): void {
    this.channel.write(`${line}\r\n`);
  }

  /**
   * Buang isi buffer. Dipakai setelah satu langkah login ditangani, supaya
   * penantian berikutnya hanya melihat keluaran BARU — bukan teks lama yang
   * masih cocok dengan pola dan membuat satu langkah terulang terus.
   */
  clear(): void {
    this.buffer = '';
  }

  /** Keluaran mentah terakhir (untuk pesan galat yang bisa dibaca manusia). */
  tail(limit = 160): string {
    const flat = this.buffer.replace(/\s+/g, ' ').trim();
    return flat.length > limit ? `…${flat.slice(-limit)}` : flat;
  }

  /**
   * Tunggu sampai prompt muncul. Bila keluaran panjang dan perangkat berhenti
   * di `--More--`, spasi dikirim otomatis (di answerPaging).
   */
  waitFor(pattern: RegExp = this.prompt, timeoutMs = 20_000, command = ''): Promise<string> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ShellTimeoutError(command, timeoutMs, this.tail()));
      }, timeoutMs);
      this.waiter = { pattern, resolve, reject, timer, command };
      // Keluaran bisa saja sudah lengkap sebelum waitFor dipanggil.
      this.settle();
    });
  }

  /** Jalankan perintah dan kembalikan seluruh keluarannya (termasuk echo). */
  async run(command: string, timeoutMs = 20_000): Promise<string> {
    this.buffer = '';
    this.send(command);
    const output = await this.waitFor(this.prompt, timeoutMs, command);
    this.buffer = '';
    return output;
  }

  async close(): Promise<void> {
    try {
      this.send('exit');
    } catch {
      // Kanal mungkin sudah tertutup; abaikan.
    }
    this.channel.close();
  }

  private settle(): void {
    const waiter = this.waiter;
    if (!waiter) return;
    if (!waiter.pattern.test(this.buffer)) return;
    clearTimeout(waiter.timer);
    this.waiter = null;
    waiter.resolve(this.buffer);
  }

  /**
   * Halaman keluaran panjang berhenti di `--More--` dan menunggu tombol.
   * Tanpa ini, perintah seperti `show onu optical-info` akan selalu timeout.
   */
  private answerPaging(): void {
    if (!MORE_MARKER.test(this.buffer)) return;
    this.buffer = this.buffer.replace(MORE_MARKER, '');
    this.channel.write(' ');
    MORE_MARKER.lastIndex = 0;
  }
}
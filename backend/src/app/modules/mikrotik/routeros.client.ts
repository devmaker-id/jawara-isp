import { connect, Socket } from 'node:net';
import { createHash } from 'node:crypto';

// =====================================================================
// Klien RouterOS API (protokol biner TCP, bukan WebSocket).
//
// Port API RouterOS di perangkat ini 1998 (bukan 8728). Tidak ada JSON:
// setiap "sentence" adalah daftar kata yang masing-masing diawali panjang
// (length-prefixed) dan diakhiri satu kata kosong (0x00).
//
// Referensi perilaku yang dipakai:
//   * login lama  → server membalas !done dengan =ret=<challenge hex>,
//     klien mengirim =response=00 + md5("\0" + password + challenge)
//   * login baru (ROS >= 6.43) → /login + =name= + =password= langsung diterima
//   * balasan     → !re (record, boleh berulang), !done, !trap, !fatal
// =====================================================================

export type RouterOsRecord = Record<string, string>;
export type RouterOsSentence = string[];

// RouterOS membatasi satu kata pada 0x0FFFFFFF byte (batas 4-byte header).
const MAX_WORD_LENGTH = 0x0fffffff;

export class RouterOsError extends Error {
  constructor(
    message: string,
    readonly kind: 'connection' | 'timeout' | 'login' | 'trap' | 'protocol' = 'protocol',
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'RouterOsError';
  }
}

export function encodeLength(length: number): Buffer {
  if (!Number.isInteger(length) || length < 0 || length > MAX_WORD_LENGTH) {
    throw new RouterOsError(
      length > MAX_WORD_LENGTH
        ? `Panjang kata melebihi batas RouterOS: ${length}`
        : `Panjang kata RouterOS tidak valid: ${length}`,
      'protocol',
    );
  }
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(length | 0x8000, 0);
    return buffer;
  }
  if (length < 0x200000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = ((length >> 16) & 0x1f) | 0xc0;
    buffer[1] = (length >> 8) & 0xff;
    buffer[2] = length & 0xff;
    return buffer;
  }
  if (length < 0x10000000) {
    const buffer = Buffer.alloc(4);
    // >>> 0 wajib: writeUInt32BE menolak nilai yang dianggap negatif.
    buffer.writeUInt32BE((length | 0xe0000000) >>> 0, 0);
    return buffer;
  }
  throw new RouterOsError(`Panjang kata melebihi batas RouterOS: ${length}`, 'protocol');
}

export function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const word of words) {
    const body = Buffer.from(word, 'utf8');
    if (body.length > MAX_WORD_LENGTH) {
      throw new RouterOsError(`Kata terlalu panjang (${body.length} byte)`, 'protocol');
    }
    parts.push(encodeLength(body.length), body);
  }
  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}

// Parser inkremental: potongan TCP bisa memenggal satu kata/sentence.
export class SentenceDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): RouterOsSentence[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const sentences: RouterOsSentence[] = [];

    while (this.buffer.length > 0) {
      const parsed = this.readSentence(this.buffer);
      if (!parsed) break;
      sentences.push(parsed.sentence);
      this.buffer = this.buffer.subarray(parsed.bytes);
    }
    return sentences;
  }

  private readSentence(buffer: Buffer): { sentence: RouterOsSentence; bytes: number } | null {
    const words: string[] = [];
    let offset = 0;

    for (;;) {
      if (offset >= buffer.length) return null;
      const first = buffer[offset];
      let length: number;
      let headerLength: number;

      if (first < 0x80) {
        length = first;
        headerLength = 1;
      } else if ((first & 0xc0) === 0x80) {
        if (buffer.length < offset + 2) return null;
        length = ((first & 0x3f) << 8) | buffer[offset + 1];
        headerLength = 2;
      } else if ((first & 0xe0) === 0xc0) {
        if (buffer.length < offset + 3) return null;
        length =
          ((first & 0x1f) << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
        headerLength = 3;
      } else if ((first & 0xf0) === 0xe0) {
        if (buffer.length < offset + 4) return null;
        length = buffer.readUInt32BE(offset) & 0x0fffffff;
        headerLength = 4;
      } else if (first === 0xf0) {
        if (buffer.length < offset + 5) return null;
        length = buffer.readUInt32BE(offset + 1);
        headerLength = 5;
      } else {
        throw new RouterOsError(`Header panjang tidak dikenal: 0x${first.toString(16)}`, 'protocol');
      }

      offset += headerLength;
      if (length === 0) {
        return { sentence: words, bytes: offset };
      }
      if (buffer.length < offset + length) return null;
      words.push(buffer.subarray(offset, offset + length).toString('utf8'));
      offset += length;
    }
  }
}

export interface RouterOsClientOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  timeoutMs?: number;
}

export interface RouterOsResult {
  records: RouterOsRecord[];
  traps: string[];
}

// Satu koneksi per permintaan: siklus pendek dan tidak ada state bersama yang
// bisa saling menimpa saat beberapa pengguna membuka panel bersamaan.
export class RouterOsClient {
  constructor(private readonly options: RouterOsClientOptions) {}

  // Satu koneksi untuk banyak perintah; hasil dipisah per perintah agar
  // pemanggil tidak mencampur rekaman dari path yang berbeda.
  async executeEach(commands: RouterOsSentence[]): Promise<RouterOsResult[]> {
    const timeoutMs = this.options.timeoutMs ?? 8000;
    const socket = await this.open(timeoutMs);
    try {
      await this.login(socket, timeoutMs);
      const results: RouterOsResult[] = [];
      for (const command of commands) {
        const result = await this.send(socket, command, timeoutMs);
        if (result.traps.length > 0) {
          throw new RouterOsError(
            `Perintah ${command[0]} ditolak RouterOS`,
            'trap',
            result.traps.join('; '),
          );
        }
        results.push(result);
      }
      return results;
    } finally {
      socket.destroy();
    }
  }

  async execute(commands: RouterOsSentence[]): Promise<RouterOsResult> {
    const results = await this.executeEach(commands);
    return {
      records: results.flatMap((result) => result.records),
      traps: results.flatMap((result) => result.traps),
    };
  }

  private open(timeoutMs: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new RouterOsError(
            `Tidak ada jawaban dari ${this.options.host}:${this.options.port} dalam ${timeoutMs} ms`,
            'timeout',
          ),
        );
      }, timeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        resolve(socket);
      });
      socket.once('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          new RouterOsError(
            `Gagal terhubung ke API MikroTik ${this.options.host}:${this.options.port} (${error.code ?? error.message})`,
            'connection',
            error.code,
          ),
        );
      });
    });
  }

  private async login(socket: Socket, timeoutMs: number): Promise<void> {
    if (!this.options.user) {
      throw new RouterOsError('User API MikroTik belum diisi', 'login');
    }

    const attempt = await this.send(
      socket,
      ['/login', `=name=${this.options.user}`, `=password=${this.options.password ?? ''}`],
      timeoutMs,
    );

    if (attempt.traps.length > 0) {
      // Login gaya lama: server menolak password kosong dan mengirim challenge.
      const challenge = attempt.records.find((record) => record.ret)?.ret;
      if (!challenge) {
        throw new RouterOsError(
          'Login API MikroTik ditolak. Periksa user/password pada Pengaturan.',
          'login',
          attempt.traps.join('; '),
        );
      }
      const digest = createHash('md5')
        .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(this.options.password ?? '', 'utf8')]))
        .update(Buffer.from(challenge, 'hex'))
        .digest('hex');
      const legacy = await this.send(
        socket,
        ['/login', `=name=${this.options.user}`, `=response=00${digest}`],
        timeoutMs,
      );
      if (legacy.traps.length > 0) {
        throw new RouterOsError(
          'Login API MikroTik ditolak (challenge lama). Periksa user/password.',
          'login',
          legacy.traps.join('; '),
        );
      }
      return;
    }

    const challenge = attempt.records.find((record) => record.ret)?.ret;
    if (challenge) {
      const digest = createHash('md5')
        .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(this.options.password ?? '', 'utf8')]))
        .update(Buffer.from(challenge, 'hex'))
        .digest('hex');
      const legacy = await this.send(
        socket,
        ['/login', `=name=${this.options.user}`, `=response=00${digest}`],
        timeoutMs,
      );
      if (legacy.traps.length > 0) {
        throw new RouterOsError(
          'Login API MikroTik ditolak (challenge lama). Periksa user/password.',
          'login',
          legacy.traps.join('; '),
        );
      }
    }
  }

  private send(
    socket: Socket,
    words: RouterOsSentence,
    timeoutMs: number,
  ): Promise<RouterOsResult> {
    return new Promise((resolve, reject) => {
      const decoder = new SentenceDecoder();
      const records: RouterOsRecord[] = [];
      const traps: string[] = [];

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new RouterOsError(`Timeout ${timeoutMs} ms pada ${words[0]}`, 'timeout'));
      }, timeoutMs);

      const finish = () => {
        cleanup();
        // Trap dikembalikan apa adanya: login perlu memeriksanya sendiri
        // (challenge lama memakai !done lalu !trap), perintah biasa
        // menerjemahkannya menjadi error di `execute`.
        resolve({ records, traps });
      };

      const onData = (chunk: Buffer) => {
        let sentences: RouterOsSentence[];
        try {
          sentences = decoder.push(chunk);
        } catch (error) {
          cleanup();
          reject(error);
          return;
        }

        for (const sentence of sentences) {
          const type = sentence[0];
          if (type === '!re') {
            const record: RouterOsRecord = {};
            for (const word of sentence.slice(1)) {
              // Kata atribut diawali '=' (mis. "=name=BIBIT"), jadi '=' pertama
              // adalah penanda dan '=' berikutnya pemisah kunci/nilai.
              const raw = word.startsWith('=') ? word.slice(1) : word;
              const index = raw.indexOf('=');
              if (index > 0) record[raw.slice(0, index)] = raw.slice(index + 1);
            }
            records.push(record);
          } else if (type === '!trap' || type === '!fatal') {
            const message = sentence.slice(1).find((word) => word.startsWith('=message='));
            traps.push(message ? message.slice('=message='.length) : sentence.slice(1).join(' '));
            if (type === '!fatal') {
              finish();
              return;
            }
          } else if (type === '!done') {
            finish();
            return;
          }
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(new RouterOsError(`Koneksi API terputus: ${error.message}`, 'connection'));
      };

      const onClose = () => {
        cleanup();
        reject(new RouterOsError('Koneksi API ditutup RouterOS sebelum balasan lengkap', 'connection'));
      };

      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);

      try {
        socket.write(encodeSentence(words));
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

    });
  }
}
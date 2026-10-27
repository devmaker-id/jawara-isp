import { createConnection, Socket } from 'node:net';
import { PromptShell, ShellChannel, DEFAULT_PROMPT } from './prompt-shell';

/**
 * Transport telnet minimal untuk OLT yang belum mendukung SSH.
 *
 * Ditulis sendiri di atas `node:net` karena hanya butuh dua hal: buang
 * negosiasi telnet (IAC) dan teruskan teks apa adanya. Semua opsi negosiasi
 * dijawab "tidak" — perangkat hanya perlu mengirim teks.
 */
export interface TelnetOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  promptPattern?: string | null;
  timeoutMs?: number;
}

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

export const connectTelnet = (options: TelnetOptions): Promise<PromptShell> =>
  new Promise<PromptShell>((resolve, reject) => {
    const socket = createConnection({ host: options.host, port: options.port });
    const timeout = options.timeoutMs ?? 20_000;
    let settled = false;
    let sawLogin = false;
    let negotiate = false;

    socket.setTimeout(timeout);
    socket.on('timeout', () => fail('Telnet tidak menjawab (timeout) — periksa host/port dan tunnel.'));
    socket.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED') fail('Port telnet menolak koneksi — periksa port dan alamat.');
      else if (code === 'ENOTFOUND') fail('Host OLT tidak ditemukan — periksa alamat.');
      else fail(error.message);
    });

    function fail(message: string) {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(message));
    }

    const channel: ShellChannel = {
      write: (data: string) => socket.write(data),
      close: () => socket.end(),
      onData: () => undefined,
      onClose: () => undefined,
    };

    const dataListeners: Array<(chunk: string) => void> = [];
    const closeListeners: Array<(error?: Error) => void> = [];

    socket.on('data', (raw: Buffer) => {
      const text = stripTelnet(raw, socket, (value) => {
        negotiate = value;
      });
      if (!text) return;

      // Login otomatis: perangkat menanyakan username lalu password.
      if (!sawLogin) {
        if (/login:|username:|user name:/i.test(text)) {
          socket.write(`${options.username}\r\n`);
          return;
        }
        if (/password:/i.test(text)) {
          sawLogin = true;
          socket.write(`${options.password}\r\n`);
          const prompt = options.promptPattern
            ? new RegExp(options.promptPattern)
            : DEFAULT_PROMPT;
          settled = true;
          resolve(new PromptShell({ ...channel, onData: (fn) => dataListeners.push(fn), onClose: (fn) => closeListeners.push(fn) }, prompt));
          return;
        }
      }

      for (const listener of dataListeners) listener(text);
    });

    socket.on('close', () => {
      for (const listener of closeListeners) listener(new Error('koneksi telnet ditutup'));
    });

    void negotiate;
  });

/**
 * Buang byte negosiasi telnet. Setiap DO dijawab WONT dan setiap WILL dijawab
 * DONT; subnegotiation (SB..SE) dibuang seluruhnya.
 */
function stripTelnet(raw: Buffer, socket: Socket, onNegotiate: (value: boolean) => void): string {
  const out: number[] = [];
  let i = 0;
  let touched = false;

  while (i < raw.length) {
    const byte = raw[i];
    if (byte !== IAC) {
      out.push(byte);
      i += 1;
      continue;
    }
    touched = true;
    const command = raw[i + 1];
    const option = raw[i + 2];
    if (command === undefined) break;
    if (command === DO) {
      socket.write(Buffer.from([IAC, WONT, option]));
      i += 3;
    } else if (command === WILL) {
      socket.write(Buffer.from([IAC, DONT, option]));
      i += 3;
    } else if (command === SB) {
      i += 2;
      while (i < raw.length && !(raw[i] === IAC && raw[i + 1] === SE)) i += 1;
      i += 2;
    } else if (command === IAC) {
      out.push(IAC);
      i += 2;
    } else {
      i += 2;
    }
  }

  if (touched) onNegotiate(true);
  return Buffer.from(out).toString('utf8');
}
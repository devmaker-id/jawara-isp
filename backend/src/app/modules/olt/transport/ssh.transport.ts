import { Client } from 'ssh2';
import { PromptShell, ShellChannel, DEFAULT_PROMPT } from './prompt-shell';

/**
 * Transport SSH untuk OLT.
 *
 * Memakai shell interaktif (bukan exec per perintah) karena perangkat ini
 * menyimpan status mode: setelah `configure` dan `interface gpon 0/1`, prompt
 * berubah dan perintah `show onu ...` hanya berlaku di mode itu. Satu sesi
 * untuk seluruh pembacaan jauh lebih murah daripada login berkali-kali.
 */
export interface SshOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  promptPattern?: string | null;
  timeoutMs?: number;
}

export class SshSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshSessionError';
  }
}

/** Terjemahkan galat ssh2 menjadi kalimat yang bisa dibaca operator. */
const explain = (error: Error & { level?: string; code?: string }): string => {
  const level = error.level ?? '';
  if (level === 'client-authentication') return 'Login SSH ditolak — periksa username/password.';
  if (level === 'client-timeout') return 'SSH tidak menjawab (timeout) — periksa host/port dan tunnel.';
  if (error.code === 'ECONNREFUSED') return 'Port SSH menolak koneksi — periksa port dan alamat.';
  if (error.code === 'ENOTFOUND') return 'Host OLT tidak ditemukan — periksa alamat.';
  if (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH')
    return 'Host OLT tidak bisa dijangkau dari server ini.';
  return error.message;
};

export const connectSsh = (options: SshOptions): Promise<PromptShell> =>
  new Promise<PromptShell>((resolve, reject) => {
    const client = new Client();
    const timeout = options.timeoutMs ?? 20_000;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new SshSessionError(explain(error as Error & { level?: string; code?: string })));
    };

    client.on('ready', () => {
      client.shell({ term: 'vt100', cols: 200, rows: 200 }, (error, stream) => {
        if (error) return fail(error);

        const channel: ShellChannel = {
          write: (data: string) => stream.write(data),
          close: () => {
            stream.end();
            client.end();
          },
          onData: (listener) => stream.on('data', (chunk: Buffer) => listener(chunk.toString('utf8'))),
          onClose: (listener) => {
            stream.on('close', () => listener(new Error('kanal SSH ditutup')));
            client.on('error', (err) => listener(err));
          },
        };

        const prompt = options.promptPattern
          ? new RegExp(options.promptPattern)
          : DEFAULT_PROMPT;

        if (settled) return;
        settled = true;
        resolve(new PromptShell(channel, prompt));
      });
    });

    client.on('error', fail);
    client.on('close', () => {
      if (!settled) fail(new SshSessionError('Koneksi SSH ditutup sebelum sesi siap.'));
    });

    try {
      client.connect({
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        readyTimeout: timeout,
        keepaliveInterval: 10_000,
        // Perangkat OLT lama sering hanya mendukung algoritma usang. Daftar ini
        // sengaja lebar supaya kompatibilitas lebih penting daripada preferensi.
        algorithms: {
          kex: [
            'curve25519-sha256',
            'curve25519-sha256@libssh.org',
            'ecdh-sha2-nistp256',
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1',
          ],
          cipher: [
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
            'aes128-cbc',
            'aes192-cbc',
            'aes256-cbc',
            '3des-cbc',
          ],
          serverHostKey: [
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'rsa-sha2-256',
            'rsa-sha2-512',
            'ssh-rsa',
          ],
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
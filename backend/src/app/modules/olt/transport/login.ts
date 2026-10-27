import { DEFAULT_PROMPT, PromptShell } from './prompt-shell';

/**
 * Login interaktif di dalam shell.
 *
 * Perangkat GLOBAL/VSOL yang diuji punya DUA lapis login:
 *
 *   1. autentikasi transport (SSH) — ditangani ssh2 / telnet transpannya,
 *   2. CLI yang menampilkan banner "Press Return to connect ..." lalu meminta
 *      username/password sendiri di dalam sesi.
 *
 * Tanpa penanganan lapis kedua, perintah pertama ("enable") terkirim sebagai
 * jawaban password dan perangkat menjawab "Bad UserName or Bad Password" terus
 * sampai timeout.
 *
 * Fungsi ini idempoten: bila shell langsung memberi prompt, tidak ada yang
 * dikirim.
 */
export interface LoginCredentials {
  username: string;
  password: string;
}

/** Prompt siap dipakai — memakai pola yang sama dengan PromptShell. */
const READY = DEFAULT_PROMPT;
/** Banner awal yang menunggu tombol Enter ditekan. */
const NEED_RETURN = /press\s+(?:the\s+)?(?:return|enter|any\s+key)/i;
const LOGIN_ASK = /(?:ogin|sername|user\s?name)\s*:\s*$/i;
const PASSWORD_ASK = /assword\s*:\s*$/i;
const REJECTED = /bad user\s?name|login failed|authentication failed|access denied/i;
const ANY_STEP = new RegExp(
  [READY.source, NEED_RETURN.source, LOGIN_ASK.source, PASSWORD_ASK.source, REJECTED.source].join('|'),
  'i',
);

export const loginHandshake = async (
  shell: PromptShell,
  credentials: LoginCredentials,
  timeoutMs = 20_000,
): Promise<string> => {
  let output = '';

  // Maksimal enam langkah: banner → username → password → prompt. Lebih dari
  // itu berarti perangkat berperilaku di luar pola yang dikenal, dan menunggu
  // lebih lama hanya menyembunyikan penyebabnya.
  for (let step = 0; step < 6; step += 1) {
    output = await shell.waitFor(ANY_STEP, timeoutMs, 'login').catch(() => shell.tail(400));

    if (REJECTED.test(output)) {
      throw new Error(
        'Login ke perangkat ditolak (username atau password salah). Perbaiki data perangkat lalu uji lagi.',
      );
    }

    if (NEED_RETURN.test(output)) {
      // Device menunggu Enter sebelum menampilkan prompt login.
      shell.send('');
      shell.clear();
      continue;
    }

    if (LOGIN_ASK.test(output)) {
      shell.send(credentials.username);
      shell.clear();
      continue;
    }

    if (PASSWORD_ASK.test(output)) {
      shell.send(credentials.password);
      shell.clear();
      continue;
    }

    if (READY.test(output)) return output;
  }

  throw new Error(
    'Perangkat tidak memberi prompt setelah login. Keluaran terakhir: ' +
      (output.trim().slice(-160) || '(kosong)'),
  );
};
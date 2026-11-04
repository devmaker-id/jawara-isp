import { OltConnection } from '../driver/olt-driver';
import { PromptShell } from '../transport/prompt-shell';
import { loginHandshake } from '../transport/login';
import { connectSsh } from '../transport/ssh.transport';
import { connectTelnet } from '../transport/telnet.transport';

/**
 * Kontrak driver Syslog Client OLT.
 *
 * Modul OLT memiliki dua lapis akses yang sengaja dipisah:
 *
 *   1. `OltAdapter`     — baca-saja (inventori ONU). `read_only=1` dipertahankan.
 *   2. `OltSyslogDriver` — akses tulis TERBATAS khusus konfigurasi syslog,
 *      dibuka terpisah dan digerbang izin `olt.syslog.write` di service.
 *
 * Driver syslog TIDAK mengubah kontrak baca-saja di atas: ia membangun sesinya
 * sendiri lewat transport yang sama, tetapi hanya boleh mengirim perintah yang
 * dibulatkan `buildCommands()` di bawah (bukan perintah bebas).
 */

/** Status syslog yang dibaca kembali dari perangkat (sumber kebenaran). */
export interface SyslogClientState {
  /** true bila perangkat punya tujuan syslog non-0.0.0.0 yang aktif. */
  enabled: boolean;
  /** IP kolektor yang terpasang di perangkat (null bila tidak ada). */
  collectorIp: string | null;
  /** Port kolektor (HiFocus/VSOL fixed 514; disimpan utuh untuk VSOL mendatang). */
  collectorPort: number;
  /** Kutipan read-back mentah (untuk verifikasi & audit). */
  readBack: string | null;
}

/** Nilai yang diminta operator untuk diterapkan ke perangkat. */
export interface SyslogClientTarget {
  enabled: boolean;
  /** IP kolektor internal (diabaikan saat enabled=false). */
  collectorIp: string;
  /** Port kolektor (VSOL mendukung; default 514). */
  collectorPort?: number;
  /** Daftar event/alarm yang diarahkan ke remote (khusus VSOL; default bila kosong). */
  events?: string[];
}

export interface OltSyslogDriver {
  /** Baca status syslog perangkat (read-only). */
  read(): Promise<SyslogClientState>;
  /** Terapkan target lalu baca-balik untuk verifikasi. */
  apply(target: SyslogClientTarget): Promise<SyslogClientState>;
  close(): Promise<void>;
}

export type OltSyslogDriverFactory = (connection: OltConnection) => OltSyslogDriver;

export class OltSyslogUnsupportedError extends Error {
  constructor(vendor: string) {
    super(
      `Driver syslog untuk vendor "${vendor}" belum tersedia. Driver yang ada: vsol, hisfocus, hioso, global.`,
    );
    this.name = 'OltSyslogUnsupportedError';
  }
}

/** Naik ke mode privileged (enable), memakai password enable bila diminta. */
export async function enterEnable(
  shell: PromptShell,
  enablePassword: string | null,
  loginPassword: string,
): Promise<void> {
  shell.send('enable');
  const out = await shell
    .waitFor(/(?:#\s*$|assword\s*[:]?\s*$)/i, 10_000, 'enable')
    .catch(() => '');
  if (/assword/i.test(out)) {
    const secret = enablePassword || loginPassword;
    shell.send(secret);
    await shell.waitFor(/#\s*$/, 10_000, 'enable password');
  }
}

/**
 * Buka sesi interaktif sampai siap menerima perintah privileged.
 * Dipakai bersama oleh kedua driver syslog.
 */
export async function openSyslogSession(connection: OltConnection): Promise<PromptShell> {
  const options = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    promptPattern: connection.promptPattern,
  };
  const shell =
    connection.transport === 'telnet'
      ? await connectTelnet(options)
      : await connectSsh(options);
  try {
    await loginHandshake(shell, { username: connection.username, password: connection.password });
    await enterEnable(shell, connection.enablePassword, connection.password);
    return shell;
  } catch (error) {
    await shell.close().catch(() => undefined);
    throw error;
  }
}
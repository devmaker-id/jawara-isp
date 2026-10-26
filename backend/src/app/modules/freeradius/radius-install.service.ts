import { Injectable, Logger } from '@nestjs/common';
import { execFileSync, spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Pemasang FreeRADIUS satu-klik.
//
// Backend TIDAK punya akses root. Yang dijalankan hanyalah satu file tetap:
//   sudo -n /usr/local/sbin/jawara-radius-install
// yang dipasang administrator lewat deploy/setup-helper.sh. Skrip itu tidak
// menerima argumen dan isinya tidak berasal dari request web.
//
// Log ditampung di memori (ring buffer) + file, lalu dibaca UI dengan polling
// berbasis offset. Polling dipilih karena lebih tahan terhadap Cloudflare
// Tunnel dibanding SSE (tidak ada buffering proxy, tidak ada idle timeout).
// ============================================================================

export const HELPER_PATH = '/usr/local/sbin/jawara-radius-install';
const MAX_LINES = 2000; // ring buffer; file log tetap menyimpan semuanya

// Perintah yang dijalankan. Dapat diganti HANYA oleh kode server (untuk uji),
// tidak pernah dari request web; controller tidak meneruskan parameter apa pun.
interface Runner {
  file: string;
  args: string[];
}

const DEFAULT_RUNNER: Runner = { file: 'sudo', args: ['-n', HELPER_PATH] };

export interface InstallLogLine {
  index: number;
  text: string;
}

export interface InstallLogPage {
  lines: InstallLogLine[];
  offset: number;
  running: boolean;
  finished: boolean;
  ok: boolean | null;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  helper_installed: boolean;
  log_file: string;
}

export interface RadiusInstallProbe {
  binary: boolean;
  version: string | null;
  unit_present: boolean;
  service_active: boolean;
  config_dirs: string[];
  sql_module: boolean;
  installed: boolean;
}

@Injectable()
export class RadiusInstallService {
  private readonly logger = new Logger(RadiusInstallService.name);

  // Seam uji: hanya kode server yang boleh mengganti nilai ini. Endpoint HTTP
  // tidak meneruskan parameter apa pun ke sini, jadi tidak bisa diubah dari web.
  runner: Runner = DEFAULT_RUNNER;
  // Seam uji: lokasi helper. Di produksi selalu HELPER_PATH.
  helperPath: string = HELPER_PATH;

  private lines: InstallLogLine[] = [];
  private nextIndex = 0;
  private running = false;
  private exitCode: number | null = null;
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private ok: boolean | null = null;
  private logPath: string | null = null;
  // Nomor index terakhir yang sudah ditulis ke file; mencegah baris ganda.
  private persistedUpTo = -1;

  // Pemeriksaan baca-saja: tidak memanggil apt maupun systemctl.
  probe(): RadiusInstallProbe {
    const candidates = ['/usr/sbin/freeradius', '/usr/local/sbin/freeradius'];
    const binaryPath = candidates.find((path) => existsSync(path)) ?? null;
    const unitPresent =
      existsSync('/lib/systemd/system/freeradius.service') ||
      existsSync('/etc/systemd/system/freeradius.service');

    return {
      binary: binaryPath !== null,
      // Versi diketahui dari paket, bukan dengan menjalankan daemon.
      version: binaryPath ? this.packageVersion() : null,
      unit_present: unitPresent,
      service_active: this.serviceActive(),
      config_dirs: this.configDirs(),
      sql_module: existsSync('/usr/lib/freeradius/rlm_sql_mysql.so'),
      installed: binaryPath !== null && unitPresent,
    };
  }

  // Versi dibaca dari dpkg, jadi tidak perlu mengeksekusi biner apa pun.
  private packageVersion(): string | null {
    try {
      const out = execFileSync(
        'dpkg-query',
        ['-W', '-f=${Version}', 'freeradius'],
        { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  // PID 1 (systemd) menandai service aktif lewat symlink cgroup; dibaca tanpa
  // memanggil systemctl supaya tidak butuh D-Bus maupun root.
  private serviceActive(): boolean {
    return existsSync('/sys/fs/cgroup/system.slice/freeradius.service');
  }

  private configDirs(): string[] {
    const dirs = ['/etc/freeradius/3.0', '/etc/freeradius'];
    return dirs.filter((dir) => existsSync(dir));
  }

  state(): Omit<InstallLogPage, 'lines' | 'offset'> {
    return {
      running: this.running,
      finished: this.finishedAt !== null,
      ok: this.ok,
      exit_code: this.exitCode,
      started_at: this.startedAt,
      finished_at: this.finishedAt,
      helper_installed: existsSync(this.helperPath),
      log_file: this.logPath ?? '(belum ada pemasangan)',
    };
  }

  // Baris dari `offset` sampai akhir. UI menyimpan offset terakhir sehingga
  // tidak mengunduh ulang seluruh log setiap polling.
  log(offset: number): InstallLogPage {
    const from = Number.isFinite(offset) && offset > 0 ? offset : 0;
    return {
      lines: this.lines.filter((line) => line.index >= from),
      offset: this.nextIndex,
      ...this.state(),
    };
  }

  /**
   * Memulai pemasangan. Mengembalikan galat yang bisa dibaca manusia bila
   * helper belum dipasang atau pemasangan lain sedang berjalan.
   */
  async start(actor: { userId: number; ip: string }): Promise<InstallLogPage> {
    if (this.running) {
      throw new InstallConflictError('Pemasangan sedang berjalan. Tunggu sampai selesai.');
    }
    // Pemeriksaan helper hanya untuk jalur produksi. Runner khusus hanya bisa
    // diberikan oleh kode server (uji), tidak pernah dari request web.
    if (this.runner === DEFAULT_RUNNER && !existsSync(this.helperPath)) {
      throw new InstallNotReadyError(
        `Helper ${this.helperPath} belum dipasang di server ini. ` +
          'Jalankan sekali dari terminal server: sudo bash deploy/setup-helper.sh',
      );
    }

    // Status awal direset supaya UI mulai dari log kosong.
    this.lines = [];
    this.nextIndex = 0;
    this.exitCode = null;
    this.ok = null;
    this.finishedAt = null;
    this.startedAt = new Date().toISOString();
    this.running = true;
    this.persistedUpTo = -1;

    const dir = join(process.cwd(), 'var');
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    this.logPath = join(dir, `radius-install-${this.startedAt.replace(/[:.]/g, '-')}.log`);

    this.push(`[panel] pemasangan dimulai oleh user #${actor.userId} dari ${actor.ip || '-'}`);
    this.push(`[panel] perintah: ${this.runner.file} ${this.runner.args.join(' ')}`);
    this.push('');
    await this.persist();

    // Tanpa shell: argumen tidak diinterpretasi, tidak ada jalan untuk
    // menyisipkan perintah tambahan dari request web.
    const child = spawn(this.runner.file, this.runner.args, {
      shell: false,
      env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onLine = (chunk: Buffer): void => {
      for (const raw of chunk.toString('utf8').split('\n')) {
        const text = raw.replace(/\r$/, '');
        if (text.trim() !== '') this.push(text);
      }
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', onLine);

    child.on('error', (error) => {
      this.push(`[panel] gagal menjalankan helper: ${error.message}`);
    });

    child.on('close', (code) => {
      this.exitCode = typeof code === 'number' ? code : null;
      this.running = false;
      this.finishedAt = new Date().toISOString();
      this.ok = this.exitCode === 0;

      if (this.exitCode === 0) {
        this.push('');
        this.push('[panel] SELESAI. FreeRADIUS terpasang; belum berjalan dan belum dikonfigurasi.');
      } else {
        for (const hint of this.hintFor(this.exitCode)) this.push(`[panel] ${hint}`);
      }
      void this.persist().then(() => this.logger.log(`Pemasangan FreeRADIUS selesai exit=${this.exitCode}`));
    });

    return this.log(0);
  }

  // Menerjemahkan kode keluar sudo/apt menjadi saran tindakan yang jelas.
  private hintFor(code: number | null): string[] {
    const last = this.lines.map((line) => line.text).join('\n');
    const hints: string[] = [`Pemasangan GAGAL dengan kode keluar ${code ?? 'tidak diketahui'}.`];

    if (/a password is required|a terminal is required/i.test(last)) {
      hints.push(
        'sudo menolak tanpa password: aturan /etc/sudoers.d/jawara-radius belum aktif. ' +
          'Jalankan di server: sudo bash deploy/setup-helper.sh',
      );
    } else if (/Could not get lock|Unable to acquire the dpkg frontend lock/i.test(last)) {
      hints.push('Ada proses apt/dpkg lain yang sedang berjalan. Tunggu, lalu ulangi.');
    } else if (/Could not resolve|Temporary failure resolving|Failed to fetch/i.test(last)) {
      hints.push('Server tidak bisa menjangkau repositori apt. Periksa DNS dan koneksi keluar.');
    } else if (/No space left on device/i.test(last)) {
      hints.push('Ruang disk habis. Kosongkan ruang sebelum mencoba lagi.', 'Server tetap pada kondisi sebelumnya.');
    } else {
      hints.push('Lihat baris error di atas. Tidak ada data panel, MariaDB, maupun MikroTik yang diubah.');
    }
    return hints;
  }

  private push(text: string): void {
    this.lines.push({ index: this.nextIndex, text });
    this.nextIndex += 1;
    // Ring buffer: log lama dibuang dari memori, tetap ada di file.
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
    }
  }

  private async persist(): Promise<void> {
    if (!this.logPath) return;
    const fresh = this.lines.filter((line) => line.index > this.persistedUpTo);
    if (fresh.length === 0) return;
    this.persistedUpTo = fresh[fresh.length - 1].index;
    await appendFile(this.logPath, fresh.map((line) => line.text).join('\n') + '\n').catch(
      () => undefined,
    );
  }
}

// Nama kelas eksplisit dipakai di log dan pemetaan HTTP controller.
export class InstallNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallNotReadyError';
  }
}

export class InstallConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallConflictError';
  }
}

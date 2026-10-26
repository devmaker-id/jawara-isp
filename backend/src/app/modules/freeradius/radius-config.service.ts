import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// ============================================================================
// Pengelola konfigurasi FreeRADIUS dari panel.
//
// Backend tidak punya akses root. Semua operasi dijalankan lewat satu file
// tetap: sudo -n /usr/local/sbin/jawara-radius-config <verb>
//
//   probe | read | apply | validate | start | stop | restart | reload | debug
//
// `apply` menerima spesifikasi JSON di stdin; helper memvalidasi tipe/rentang,
// menulis file, lalu memeriksa `freeradius -CX` dan rollback bila gagal.
// Nilai password database tidak pernah melewati lapisan ini: helper membuat
// dan menyimpannya sendiri (root:freerad 0640).
// ============================================================================

export const CONFIG_HELPER_PATH = '/usr/local/sbin/jawara-radius-config';

export type HelperVerb =
  | 'probe'
  | 'read'
  | 'apply'
  | 'validate'
  | 'start'
  | 'stop'
  | 'restart'
  | 'reload'
  | 'debug';

export interface RadiusConfigSettings {
  listen_address: string;
  auth_port: number;
  acct_port: number;
  db_host: string;
  db_port: number;
  db_name: string;
  db_user: string;
  read_clients: boolean;
  // Zona waktu host server RADIUS (timedatectl). Jam radacct sendiri diisi
  // MariaDB lewat FROM_UNIXTIME, jadi zona waktu sesi MySQL ikut ditampilkan.
  timezone: string;
}

export interface RadiusClock {
  epoch?: number;
  local?: string;
  now?: string;
  utc?: string;
  timezone?: string;
  ok?: boolean;
  error?: string;
}

export interface RadiusConfigRead {
  ok: boolean;
  settings: RadiusConfigSettings;
  db_password: 'managed' | 'missing';
  server_time?: RadiusClock;
  database_time?: RadiusClock | null;
  probe: {
    installed: boolean;
    service: string;
    site_enabled: boolean;
    sql_module_enabled: boolean;
  };
}

export interface RadiusConfigApplyResult {
  ok: boolean;
  settings: RadiusConfigSettings;
  db_password: string;
  db_user_ready: boolean;
  db_error: string | null;
  reloaded: boolean;
  service: string;
  server_time?: RadiusClock;
  validation: string[];
}

export class RadiusConfigNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RadiusConfigNotReadyError';
  }
}

export class RadiusConfigRejectedError extends Error {
  constructor(
    message: string,
    readonly validation: string[] = [],
  ) {
    super(message);
    this.name = 'RadiusConfigRejectedError';
  }
}

@Injectable()
export class RadiusConfigService {
  private readonly logger = new Logger(RadiusConfigService.name);

  // Seam uji: hanya kode server yang boleh mengganti perintah ini.
  runner: { file: string; args: string[] } | null = null;

  available(): boolean {
    return existsSync(CONFIG_HELPER_PATH);
  }

  private command(verb: HelperVerb): { file: string; args: string[] } {
    return this.runner ?? { file: 'sudo', args: ['-n', CONFIG_HELPER_PATH, verb] };
  }

  private invoke<T>(verb: HelperVerb, stdin?: string, timeoutMs = 90_000): Promise<T> {
    if (!this.runner && !this.available()) {
      return Promise.reject(
        new RadiusConfigNotReadyError(
          `Helper ${CONFIG_HELPER_PATH} belum dipasang. Jalankan sekali di server: ` +
            'sudo bash deploy/setup-helper.sh',
        ),
      );
    }

    const { file, args } = this.command(verb);
    return new Promise<T>((resolve, reject) => {
      const child = spawn(file, args, {
        shell: false,
        env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new RadiusConfigNotReadyError(`Waktu habis (${timeoutMs / 1000}s) menjalankan ${verb}.`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new RadiusConfigNotReadyError(`Helper tidak bisa dijalankan: ${error.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const text = out.trim();
        if (!text) {
          reject(
            new RadiusConfigNotReadyError(
              `Helper ${verb} tidak mengeluarkan hasil (kode ${code}). ${err.trim().slice(0, 200)}`,
            ),
          );
          return;
        }
        let parsed: T & { ok?: boolean; error?: string; validation?: string[] };
        try {
          parsed = JSON.parse(text) as T & { ok?: boolean; error?: string; validation?: string[] };
        } catch {
          reject(new RadiusConfigNotReadyError(`Balasan helper tidak bisa dibaca: ${text.slice(0, 200)}`));
          return;
        }
        if (parsed.ok === false) {
          reject(new RadiusConfigRejectedError(parsed.error ?? 'Perintah ditolak helper.', parsed.validation));
          return;
        }
        resolve(parsed as T);
      });

      if (stdin !== undefined) child.stdin.end(stdin);
      else child.stdin.end();
    });
  }

  async probe(): Promise<Record<string, unknown>> {
    return this.invoke('probe', undefined, 15_000);
  }

  async read(): Promise<RadiusConfigRead> {
    return this.invoke<RadiusConfigRead>('read', undefined, 15_000);
  }

  async apply(spec: RadiusConfigSettings): Promise<RadiusConfigApplyResult> {
    const result = await this.invoke<RadiusConfigApplyResult>('apply', JSON.stringify(spec), 120_000);
    this.logger.log(
      `Konfigurasi FreeRADIUS diterapkan (valida=${result.validation?.length ? 'ok' : '-'}, ` +
        `reload=${result.reloaded}, service=${result.service})`,
    );
    return result;
  }

  async validate(): Promise<{ ok: boolean; valid: boolean; output: string[] }> {
    return this.invoke('validate', undefined, 90_000);
  }

  async control(action: 'start' | 'stop' | 'restart' | 'reload'): Promise<{ service: string }> {
    return this.invoke(action, undefined, 120_000);
  }

  // Membutuhkan waktu ~10 detik: service dihentikan sementara oleh helper.
  async debug(): Promise<{ output: string[]; service: string }> {
    return this.invoke('debug', undefined, 60_000);
  }
}

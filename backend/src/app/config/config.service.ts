import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type Role = 'admin' | 'operator' | 'resseler';

// Nilai runtime untuk @IsEnum() dan validasi. Sebelumnya baris ini
// `Object.freeze` tanpa argumen, sehingga `Role` berisi referensi fungsi
// dan @IsEnum(Role) menolak SEMUA role yang valid.
export const Role = Object.freeze({
  ADMIN: 'admin',
  OPERATOR: 'operator',
  RESSELER: 'resseler',
} as const);

// Alias lama, dipertahankan agar import yang sudah ada tidak putus.
export const RoleValues = Role;

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface FreeRadiusConfig {
  host: string;
  secret: string;
  port: number;
}

export interface MikrotikConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  freeradius: FreeRadiusConfig;
  mikrotik: MikrotikConfig;
  secretKey: string;
  jwtSecret: string;
}

// Database masih dibutuhkan agar aplikasi bisa terhubung ke MySQL
// (termasuk tabel yang menyimpan konfigurasi Mikrotik).
const REQUIRED_ENV = [
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'FREERADIUS_HOST', 'FREERADIUS_SECRET',
  'SECRET_KEY', 'JWT_SECRET',
];

@Injectable()
export class ConfigService {
  private mikrotikCache?: MikrotikConfig;

  private readonly env: { [key: string]: string | undefined } = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    FREERADIUS_HOST: process.env.FREERADIUS_HOST,
    FREERADIUS_SECRET: process.env.FREERADIUS_SECRET,
    // MIKROTIK_* tidak dibaca dari .env lagi; dibaca dari tabel config.
    SECRET_KEY: process.env.SECRET_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
  };

  constructor(private readonly db: DatabaseService) {
    for (const key of REQUIRED_ENV) {
      if (!this.env[key]) {
        console.warn(`Config warning: ${key} is not set`);
      }
    }
  }

  // Baca dari tabel `config` (database), jatuh ke env/.default kalau kosong.
  private async getConfigValue(key: string): Promise<string> {
    try {
      const row = await this.db.queryOne<{ config_value: string }>(
        'SELECT config_value FROM config WHERE config_key = ?',
        [key],
      );
      if (row && row.config_value != null) {
        return String(row.config_value);
      }
    } catch (error) {
      // database belum siap / tidak reachable: pakai env/default
    }
    return '';
  }

  private async getConfigOrEnv(
    dbKey: string,
    envKey: string,
    fallback: string,
  ): Promise<string> {
    const dbValue = await this.getConfigValue(dbKey);
    if (dbValue !== '') return dbValue;
    return this.get(envKey, fallback);
  }

  // Membaca seluruh konfigurasi Mikrotik dari database.
  public async getMikrotikConfig(): Promise<MikrotikConfig> {
    if (this.mikrotikCache) return this.mikrotikCache;

    const host = await this.getConfigOrEnv(
      'mikrotik_host', 'MIKROTIK_HOST', '192.168.100.254',
    );
    const user = await this.getConfigOrEnv(
      'mikrotik_user', 'MIKROTIK_USER', 'hermes',
    );
    const password = await this.getConfigOrEnv(
      'mikrotik_password', 'MIKROTIK_PASSWORD', '',
    );

    const envPort = process.env.MIKROTIK_PORT;
    let port: number;
    if (envPort) {
      port = parseInt(envPort, 10);
    } else {
      const dbPort = await this.getConfigValue('mikrotik_port');
      port = dbPort !== '' ? parseInt(dbPort, 10) : 1998;
    }

    this.mikrotikCache = { host, port, user, password };
    return this.mikrotikCache;
  }

  private get(key: string, fallback: string = ''): string {
    return this.env[key] ?? fallback;
  }

  private getInt(key: string, fallback: number): number {
    const val = this.env[key];
    if (val && /^\d+$/.test(val)) {
      return parseInt(val, 10);
    }
    return fallback;
  }

  public readonly app = {
    port: this.getInt('PORT', 7930),
  };

  public readonly database = {
    host: this.get('DB_HOST', '127.0.0.1'),
    port: this.getInt('DB_PORT', 3306),
    user: this.get('DB_USER', 'isp_billing'),
    password: this.get('DB_PASSWORD', ''),
    name: this.get('DB_NAME', 'isp_billing'),
  };

  public readonly freeradius = {
    host: this.get('FREERADIUS_HOST', '127.0.0.1'),
    secret: this.get('FREERADIUS_SECRET', ''),
    port: this.getInt('FREERADIUS_PORT', 1812),
  };

  public readonly mikrotik = {
    host: this.get('MIKROTIK_HOST', '192.168.100.254'),
    port: this.getInt('MIKROTIK_PORT', 1998),
    user: this.get('MIKROTIK_USER', 'hermes'),
    password: this.get('MIKROTIK_PASSWORD', ''),
  };

  // Tanpa fallback: secret yang tertulis di source membuat token bisa dipalsukan.
  // Nilai kosong akan menggagalkan boot (lihat assertRequiredSecrets).
  public readonly secretKey = this.get('SECRET_KEY', '');
  public readonly jwtSecret = this.get('JWT_SECRET', '');

  // Dipanggil saat boot; lebih baik gagal jelas daripada berjalan dengan
  // secret default yang bisa ditebak.
  public assertRequiredSecrets(): void {
    const missing = (['JWT_SECRET', 'SECRET_KEY'] as const).filter(
      (key) => !this.env[key] || this.env[key]!.trim().length === 0,
    );
    if (missing.length > 0) {
      throw new Error(
        `Secret wajib belum diisi pada backend/.env: ${missing.join(', ')}. ` +
          'Aplikasi tidak dijalankan agar token tidak ditandatangani dengan nilai default.',
      );
    }
  }
}

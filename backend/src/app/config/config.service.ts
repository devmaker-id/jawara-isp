import { Injectable } from '@nestjs/common';
import { networkInterfaces } from 'node:os';

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

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  freeradius: FreeRadiusConfig;
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
  private readonly env: { [key: string]: string | undefined } = {
    // PORT dibaca agar instance uji bisa jalan di samping instance produksi
    // (mis. PORT=7931 dengan DB_NAME salinan). Tanpa isian = 7930.
    PORT: process.env.PORT,
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    FREERADIUS_HOST: process.env.FREERADIUS_HOST,
    FREERADIUS_SECRET: process.env.FREERADIUS_SECRET,
    // Alamat yang dipakai NAS untuk menghubungi server ini. Tanpa ini, panel
    // menebak dari interface non-loopback pertama — sering salah.
    FREERADIUS_NAS_ADDRESS: process.env.FREERADIUS_NAS_ADDRESS,
    SECRET_KEY: process.env.SECRET_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
  };

  constructor() {
    for (const key of REQUIRED_ENV) {
      if (!this.env[key]) {
        console.warn(`Config warning: ${key} is not set`);
      }
    }
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
    // Alamat yang dipakai NAS untuk menghubungi server ini. Bila tidak diisi,
    // pakai FREERADIUS_HOST (kalau bukan loopback) atau IP non-loopback pertama.
    nas_address: this.get('FREERADIUS_NAS_ADDRESS', '') || firstExternalIpv4(),
  };

  public readonly secretKey = this.get('SECRET_KEY', '');
  // Tanpa fallback: secret yang tertulis di source membuat token bisa dipalsukan.
  // Nilai kosong menggagalkan boot lewat assertRequiredSecrets().
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

/**
 * IP non-loopback pertama milik mesin ini. Dipakai sebagai alamat NAS bawaan
 * ketika FREERADIUS_NAS_ADDRESS tidak diisi: NAS tidak bisa memakai 127.0.0.1.
 */
function firstExternalIpv4(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

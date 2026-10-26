import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guard keamanan test (bukan kode produksi).
//
// Tujuan: tes yang menulis ke database harus menolak berjalan bila konfigurasi
// database menunjuk ke database produksi. Nilai default ConfigService untuk
// DB_NAME juga 'isp_billing', jadi konfigurasi yang kosong pun dianggap
// produksi — bukan "aman karena tidak diisi".
export const PRODUCTION_DB_NAMES = ['isp_billing'];

// Nama database yang dianggap terisolasi untuk test.
const ISOLATED_DB_PATTERN = /(test|isolat|_it$)/i;

export interface DatabaseTarget {
  host: string;
  port: number;
  name: string;
}

export class TestDatabaseBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestDatabaseBlockedError';
  }
}

// Parser .env minimal (cukup untuk DB_*): komentar dan tanda kutip diabaikan.
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// Sumber konfigurasi yang sama dengan aplikasi: file .env backend lalu env
// process (env menang, seperti ConfigModule.forRoot).
export function resolveDatabaseTarget(
  overrides: { env?: Record<string, string>; target?: Partial<DatabaseTarget> } = {},
): DatabaseTarget {
  let fileEnv: Record<string, string> = {};
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'backend/.env')];
  for (const path of candidates) {
    if (existsSync(path)) {
      fileEnv = parseEnvFile(readFileSync(path, 'utf8'));
      break;
    }
  }

  const env = { ...fileEnv, ...overrides.env };
  const pick = (key: string) => {
    const fromProcess = overrides.env ? undefined : process.env[key];
    return fromProcess ?? env[key];
  };

  return {
    // Default ConfigService: DB_NAME 'isp_billing', host 127.0.0.1, port 3306.
    name: overrides.target?.name ?? pick('DB_NAME') ?? 'isp_billing',
    host: overrides.target?.host ?? pick('DB_HOST') ?? '127.0.0.1',
    port: overrides.target?.port ?? Number(pick('DB_PORT') ?? 3306),
  };
}

export function isProductionDatabase(target: DatabaseTarget): boolean {
  const name = target.name.trim().toLowerCase();
  return PRODUCTION_DB_NAMES.includes(name);
}

export function isIsolatedDatabase(target: DatabaseTarget): boolean {
  return !isProductionDatabase(target) && ISOLATED_DB_PATTERN.test(target.name.trim());
}

// Dipanggil di awal tes yang menyentuh database.
// - action 'read'  : cukup menolak database produksi.
// - action 'write' : wajib database terisolasi (mis. isp_billing_test) dan
//                    bukan produksi.
export function assertSafeTestDatabase(
  action: 'read' | 'write' = 'write',
  target: DatabaseTarget = resolveDatabaseTarget(),
): DatabaseTarget {
  if (isProductionDatabase(target)) {
    throw new TestDatabaseBlockedError(
      `TES DIBLOKIR: konfigurasi database menunjuk ke database produksi "${target.name}". ` +
        'Gunakan fake repository atau database terisolasi (mis. isp_billing_test). ' +
        'Tes tidak boleh menulis ke database produksi.',
    );
  }
  if (action === 'write' && !isIsolatedDatabase(target)) {
    throw new TestDatabaseBlockedError(
      `TES DIBLOKIR: database "${target.name}" bukan database test terisolasi. ` +
        'Nama database harus mengandung "test"/"isolat" atau berakhiran "_it".',
    );
  }
  return target;
}

// Keterangan singkat tanpa membocorkan kredensial.
export function describeDatabaseTarget(target: DatabaseTarget = resolveDatabaseTarget()): string {
  return `db=${target.name} host=${target.host}:${target.port}`;
}
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseService } from '../../database/database.service';

const run = promisify(execFile);

/**
 * Tabel yang boleh diekspor/diimpor lewat panel.
 *
 * Daftar putih, bukan daftar hitam: tabel internal MySQL dan tabel yang
 * dipegang FreeRADIUS sendiri tidak boleh disentuh dari sini.
 */
export const TOOLS_TABLES = [
  'customers',
  'invoices',
  'payments',
  'packages',
  'users',
  'mikrotik_devices',
  'bandwidth_profiles',
  'group_profiles',
  'hotspot_profiles',
  'ppp_profiles',
  'radius_vouchers',
  'radcheck',
  'radreply',
  'radusergroup',
  'radgroupcheck',
  'radgroupreply',
  'radippool',
  'radacct',
  'radpostauth',
] as const;

/** Batas baris ekspor CSV; file lebih besar sebaiknya lewat mysqldump. */
const CSV_ROW_LIMIT = 50_000;

export interface TableInfo {
  table: string;
  rows: number;
  columns: string[];
}

export interface ImportResult {
  table: string;
  format: 'csv' | 'sql';
  inserted: number;
  skipped: number;
  backup: string | null;
  messages: string[];
}

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(private readonly db: DatabaseService) {}

  private assertTable(table: string): string {
    const name = (table ?? '').trim();
    if (!(TOOLS_TABLES as readonly string[]).includes(name)) {
      throw new BadRequestException(
        `Tabel "${name}" tidak tersedia untuk impor/ekspor. Pilihan: ${TOOLS_TABLES.join(', ')}.`,
      );
    }
    return name;
  }

  async listTables(): Promise<TableInfo[]> {
    const out: TableInfo[] = [];
    for (const table of TOOLS_TABLES) {
      const row = await this.db.queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${table}\``);
      const cols = await this.db.query<{ Field: string }>(
        `SELECT COLUMN_NAME AS Field FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [table],
      );
      out.push({ table, rows: Number(row?.total ?? 0), columns: cols.map((c) => c.Field) });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Ekspor
  // ---------------------------------------------------------------------------
  async exportCsv(table: string): Promise<{ filename: string; content: string }> {
    const name = this.assertTable(table);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM \`${name}\` LIMIT ${CSV_ROW_LIMIT}`,
    );
    if (rows.length === 0) {
      return { filename: `${name}.csv`, content: '' };
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvCell).join(',')];
    for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','));
    return { filename: `${name}.csv`, content: lines.join('\n') };
  }

  /** Dump satu tabel memakai mysqldump: hasilnya skema + data, bisa dipulihkan. */
  async exportSql(table: string): Promise<{ filename: string; content: string }> {
    const name = this.assertTable(table);
    const args = [
      '-h', process.env.DB_HOST || '127.0.0.1',
      '-P', String(process.env.DB_PORT || 3306),
      '-u', process.env.DB_USER || '',
      `--password=${process.env.DB_PASSWORD || ''}`,
      '--single-transaction',
      '--no-tablespaces',
      '--skip-comments',
      process.env.DB_NAME || '',
      name,
    ];
    try {
      const { stdout } = await run('mysqldump', args, { maxBuffer: 64 * 1024 * 1024 });
      return { filename: `${name}.sql`, content: stdout };
    } catch (error) {
      const detail = (error as { stderr?: string; message?: string }).stderr?.trim();
      throw new BadRequestException(
        `mysqldump gagal untuk tabel ${name}: ${detail || (error as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Impor
  // ---------------------------------------------------------------------------
  async import(
    table: string,
    format: 'csv' | 'sql',
    content: string,
    mode: 'append' | 'replace',
  ): Promise<ImportResult> {
    if (!content || content.trim() === '') {
      throw new BadRequestException('Isi file kosong.');
    }

    if (format === 'csv') {
      const name = this.assertTable(table);
      const backup = await this.backup(name);
      return this.importCsv(name, content, mode, backup);
    }

    // .sql tidak menyebut satu tabel saja, jadi nama tabel tidak relevan dan
    // cadangannya diambil untuk seluruh database.
    const backup = await this.backup(null);
    return this.importSql(content, backup);
  }

  /**
   * Cadangan sebelum impor. Impor CSV menimpa data, dan kesalahan ketik pada
   * file tidak bisa dibatalkan — jadi salinan tabel diambil lebih dulu.
   */
  private async backup(table: string | null): Promise<string | null> {
    const dir = process.env.TOOLS_BACKUP_DIR || `${process.env.HOME || '/tmp'}/backups`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const label = table ?? 'database';
    const path = `${dir}/import-${label}-${stamp}.sql`;
    try {
      await run('mkdir', ['-p', dir]);
      await run('mysqldump', [
        '-h', process.env.DB_HOST || '127.0.0.1',
        '-P', String(process.env.DB_PORT || 3306),
        '-u', process.env.DB_USER || '',
        `--password=${process.env.DB_PASSWORD || ''}`,
        '--single-transaction',
        '--no-tablespaces',
        '--skip-comments',
        '--result-file', path,
        process.env.DB_NAME || '',
        ...(table ? [table] : []),
      ]);
      this.logger.log(`Cadangan sebelum impor: ${path}`);
      return path;
    } catch (error) {
      // Tanpa cadangan, impor tidak boleh jalan.
      const detail = (error as { stderr?: string }).stderr?.trim();
      throw new BadRequestException(
        `Gagal membuat cadangan sebelum impor: ${detail || (error as Error).message}`,
      );
    }
  }

  private async importCsv(
    table: string,
    content: string,
    mode: 'append' | 'replace',
    backup: string | null,
  ): Promise<ImportResult> {
    const rows = parseCsv(content);
    if (rows.length < 2) {
      throw new BadRequestException('CSV harus punya baris judul dan minimal satu baris data.');
    }
    const headers = rows[0].map((h) => h.trim());
    const columns = await this.db.query<{ Field: string }>(
      `SELECT COLUMN_NAME AS Field FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    const known = new Set(columns.map((c) => c.Field));
    const unknown = headers.filter((h) => !known.has(h));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Kolom tidak dikenal pada tabel ${table}: ${unknown.join(', ')}. ` +
          `Kolom yang ada: ${[...known].join(', ')}.`,
      );
    }

    let inserted = 0;
    let skipped = 0;
    const messages: string[] = [];

    await this.db.withTransaction(async (conn) => {
      if (mode === 'replace') {
        await conn.query(`DELETE FROM \`${table}\``);
        messages.push(`Seluruh isi ${table} dihapus lebih dulu (mode replace).`);
      }
      const placeholders = headers.map(() => '?').join(', ');
      const sql =
        `INSERT INTO \`${table}\` (${headers.map((h) => `\`${h}\``).join(', ')}) ` +
        `VALUES (${placeholders})`;
      for (let i = 1; i < rows.length; i += 1) {
        const line = rows[i];
        if (line.length === 1 && line[0].trim() === '') continue;
        if (line.length !== headers.length) {
          skipped += 1;
          if (messages.length < 5) {
            messages.push(`Baris ${i + 1} dilewati: ${line.length} kolom, seharusnya ${headers.length}.`);
          }
          continue;
        }
        await conn.query(sql, line.map((cell) => (cell === '' ? null : cell)));
        inserted += 1;
      }
    });

    return { table, format: 'csv', inserted, skipped, backup, messages };
  }

  /**
   * Impor .sql menjalankan pernyataan apa adanya.
   *
   * Yang ditolak: pernyataan yang bisa menghapus database atau mengubah hak
   * akses. Sisanya dibiarkan — kalau file-nya memang dump tabel, itu tujuannya.
   */
  private async importSql(content: string, backup: string | null): Promise<ImportResult> {
    const forbidden = /\b(DROP\s+DATABASE|DROP\s+SCHEMA|CREATE\s+USER|ALTER\s+USER|GRANT\s|SET\s+GLOBAL)\b/i;
    const hit = content.match(forbidden);
    if (hit) {
      throw new BadRequestException(
        `Impor .sql ditolak: file memuat pernyataan terlarang "${hit[0]}". ` +
          'Panel hanya menerima dump tabel, bukan perintah tingkat server.',
      );
    }

    const statements = splitSql(content);
    if (statements.length === 0) {
      throw new BadRequestException('Tidak ada pernyataan SQL yang bisa dijalankan.');
    }

    const messages: string[] = [];
    let executed = 0;
    for (const statement of statements) {
      try {
        await this.db.execute(statement);
        executed += 1;
      } catch (error) {
        throw new BadRequestException(
          `Pernyataan ke-${executed + 1} gagal: ${(error as Error).message}. ` +
            `Cadangan sebelum impor: ${backup ?? 'tidak ada'}.`,
        );
      }
    }
    messages.push(`${executed} pernyataan dijalankan.`);
    return { table: '-', format: 'sql', inserted: executed, skipped: 0, backup, messages };
  }
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString().slice(0, 19).replace('T', ' ') : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Parser CSV RFC 4180 secukupnya: tanda kutip ganda, koma, dan baris baru. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Pisahkan dump menjadi pernyataan; komentar dan baris kosong dibuang. */
export function splitSql(content: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted: "'" | '"' | '`' | null = null;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];

    if (!quoted && ch === '-' && content[i + 1] === '-') {
      while (i < content.length && content[i] !== '\n') i += 1;
      continue;
    }
    if (!quoted && ch === '#') {
      while (i < content.length && content[i] !== '\n') i += 1;
      continue;
    }

    current += ch;

    if (quoted) {
      if (ch === '\\') {
        current += content[i + 1] ?? '';
        i += 1;
      } else if (ch === quoted) {
        quoted = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quoted = ch as "'" | '"' | '`';
    } else if (ch === ';') {
      const statement = current.slice(0, -1).trim();
      if (statement) out.push(statement);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) out.push(tail);
  return out;
}

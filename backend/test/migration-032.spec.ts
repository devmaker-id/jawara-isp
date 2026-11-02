import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Migrasi 032 menambah periode tagihan, kunci anti-ganda, status void, dan
// finance_events. Uji ini membaca file migrasi sebagai sumber kebenaran dan
// menjaga urutan rollback yang pernah gagal di database sungguhan:
//   ERROR 1553 "Cannot drop index 'uq_invoices_period': needed in a foreign key
//   constraint" — index implisit fk_invoices_customer dilepas oleh 032 karena
//   duplikat, jadi rollback wajib membuatnya ulang sebelum unique key dilepas.
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
const codeOf = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const up = codeOf(read('../migrations/032_invoice_period_void.sql'));
const down = codeOf(read('../migrations/rollback/032_invoice_period_void_down.sql'));

describe('migrasi 032 — periode, void, finance_events', () => {
  it('menambah periode, status void, jejak pembatalan, dan kunci anti-ganda', () => {
    expect(up).toContain('ADD COLUMN period_start DATE NULL');
    expect(up).toContain('ADD COLUMN period_end DATE NULL');
    expect(up).toContain("MODIFY status ENUM('unpaid', 'paid', 'overdue', 'partial', 'void')");
    expect(up).toContain('ADD COLUMN void_reason VARCHAR(255) NULL');
    expect(up).toContain('ADD UNIQUE KEY uq_invoices_period (customer_id, username, period_key)');
    expect(up).toContain("IF(status = 'void', NULL, period_start)");
  });

  it('membuat finance_events append-only tanpa FK ke users', () => {
    expect(up).toContain('CREATE TABLE IF NOT EXISTS finance_events');
    expect(up).toContain('before_json LONGTEXT NULL');
    expect(up).toContain('after_json LONGTEXT NULL');
    expect(up).not.toMatch(/finance_events[\s\S]*CONSTRAINT .*FOREIGN KEY/);
  });

  it('tidak menghapus atau menimpa data tagihan lama', () => {
    expect(up).not.toMatch(/DROP\s+TABLE/i);
    expect(up).not.toMatch(/(^|\n)\s*DELETE\s+FROM/i);
    expect(up).not.toMatch(/TRUNCATE/i);
    expect(up).not.toMatch(/UPDATE\s+invoices/i);
  });

  it('rollback membuat ulang index fk_invoices_customer SEBELUM melepas unique key', () => {
    const addIndex = down.indexOf('ADD INDEX fk_invoices_customer');
    const dropUnique = down.indexOf("'ALTER TABLE invoices DROP INDEX uq_invoices_period'");
    expect(addIndex).toBeGreaterThan(-1);
    expect(dropUnique).toBeGreaterThan(-1);
    expect(addIndex).toBeLessThan(dropUnique);
  });

  it('rollback melepas FK voided_by sebelum mengubah ENUM status', () => {
    const dropFk = down.indexOf('DROP FOREIGN KEY fk_invoices_voided_by');
    const shrinkEnum = down.indexOf("ENUM('unpaid', 'paid', 'overdue', 'partial')");
    expect(dropFk).toBeGreaterThan(-1);
    expect(shrinkEnum).toBeGreaterThan(-1);
    expect(dropFk).toBeLessThan(shrinkEnum);
  });

  it('rollback mengembalikan void menjadi unpaid tanpa menghapus baris', () => {
    expect(down).toContain("UPDATE invoices SET status = 'unpaid' WHERE status = 'void'");
    expect(down).not.toMatch(/(^|\n)\s*DELETE\s+FROM/i);
    expect(down).not.toMatch(/DROP\s+TABLE\s+invoices/i);
  });

  it('rollback idempoten: semua langkah dijaga information_schema', () => {
    expect(down).toContain('information_schema.COLUMNS');
    expect(down).toContain('information_schema.STATISTICS');
    expect(down).toContain('DO 0');
    expect(down).toContain('DROP TABLE IF EXISTS finance_events');
  });
});

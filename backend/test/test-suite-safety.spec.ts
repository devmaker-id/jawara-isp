import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Pengaman statis: setiap spec e2e yang memakai repository asli berisiko
// menulis ke database produksi. Aturannya: setiap repository yang diimpor
// harus diganti (overrideProvider) dengan fake. Bila suatu saat butuh database
// nyata, spec wajib menandai dirinya dengan komentar `db-write-ok: isolated`
// DAN memanggil assertSafeTestDatabase('write') dari test-db-guard.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SPEC_PATTERN = /\.e2e-spec\.ts$/;
const REPOSITORY_IMPORT = /modules\/([a-z-]+)\/([a-z-]+)\.repository/g;
const OVERRIDE = /overrideProvider\((\w+)\)/g;

const pascal = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

function specFiles(): string[] {
  return readdirSync(TEST_DIR).filter((file) => SPEC_PATTERN.test(file));
}

describe('Keamanan test suite', () => {
  it('menemukan spec e2e untuk diperiksa', () => {
    expect(specFiles().length).toBeGreaterThan(5);
  });

  it('setiap repository asli yang dipakai spec e2e sudah diganti fake', () => {
    const offenders: string[] = [];

    for (const file of specFiles()) {
      const content = readFileSync(join(TEST_DIR, file), 'utf8');
      if (content.includes('db-write-ok: isolated')) continue;

      const imported = new Set(
        [...content.matchAll(REPOSITORY_IMPORT)].map((match) => `${pascal(match[2])}Repository`),
      );
      const overridden = new Set([...content.matchAll(OVERRIDE)].map((match) => match[1]));

      for (const repository of imported) {
        if (!overridden.has(repository)) {
          offenders.push(`${file} memakai ${repository} tanpa override`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('spec customers tidak lagi menyentuh tabel customers nyata', () => {
    const content = readFileSync(join(TEST_DIR, 'customers.e2e-spec.ts'), 'utf8');
    expect(content).toContain('overrideProvider(CustomersRepository)');
    expect(content).toContain('createFakeCustomers');
  });

  it('spec yang menyentuh database wajib memanggil guard keamanan DB', () => {
    const withRealDb = specFiles().filter((file) => {
      const content = readFileSync(join(TEST_DIR, file), 'utf8');
      return content.includes('db-write-ok: isolated');
    });

    for (const file of withRealDb) {
      const content = readFileSync(join(TEST_DIR, file), 'utf8');
      expect(content).toContain("assertSafeTestDatabase('write'");
    }
  });
});
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Migrasi 009 mengubah aturan FK agar data layanan selamat saat akun dihapus.
// Uji ini membaca file migrasi sebagai sumber kebenaran, sehingga perubahan
// aturan yang tidak disengaja akan langsung terlihat.
describe('migrasi 009 — aturan FK kepemilikan', () => {
  const raw = readFileSync(resolve(__dirname, '../migrations/009_soften_owner_fks.sql'), 'utf8');
  // Komentar memuat contoh rollback (CASCADE), jadi hanya kode yang diperiksa.
  const code = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('tidak ada lagi ON DELETE CASCADE pada kode migrasi', () => {
    expect(code).not.toContain('ON DELETE CASCADE');
  });

  it('keempat tabel profil memakai SET NULL', () => {
    for (const constraint of ['fk_bw_owner', 'fk_group_owner', 'fk_hs_owner', 'fk_ppp_owner']) {
      // Periksa pernyataan ADD CONSTRAINT-nya, bukan komentar atau DROP.
      const index = code.indexOf(`ADD CONSTRAINT ${constraint}`);
      expect(index, `${constraint} harus ditambahkan ulang`).toBeGreaterThan(-1);
      const statement = code.slice(index, index + 300);
      expect(statement).toContain('ON DELETE SET NULL');
    }
    expect(code.match(/ON DELETE SET NULL/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('audit_logs memakai ON DELETE RESTRICT agar riwayat tidak hilang', () => {
    const index = code.indexOf('ADD CONSTRAINT fk_audit_logs_user');
    expect(index).toBeGreaterThan(-1);
    expect(code.slice(index, index + 300)).toContain('ON DELETE RESTRICT');
  });

  it('owner_id dibuat NULL-able di keempat tabel profil', () => {
    for (const table of [
      'bandwidth_profiles',
      'group_profiles',
      'hotspot_profiles',
      'ppp_profiles',
    ]) {
      expect(code).toContain(`ALTER TABLE ${table} MODIFY owner_id INT NULL`);
    }
  });

  it('idempoten: memakai pemeriksaan information_schema + DO 0', () => {
    expect(code).toContain('information_schema.REFERENTIAL_CONSTRAINTS');
    expect(code).toContain('DO 0');
  });

  it('tidak menghapus data apa pun', () => {
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/(^|\n)\s*DELETE\s+FROM/i);
    expect(code).not.toMatch(/TRUNCATE/i);
  });

  it('memverifikasi hasil di akhir migrasi', () => {
    expect(code).toContain('_mig009_verify');
    expect(code).toContain("DELETE_RULE <> 'SET NULL'");
    expect(code).toContain("DELETE_RULE <> 'RESTRICT'");
  });
});

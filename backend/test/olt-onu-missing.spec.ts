import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portMarkAllowed } from '../src/app/modules/olt/olt.repository';

// Aturan inti Prioritas 1: sinkronisasi tidak boleh menghapus ONU, dan port
// yang gagal terbaca tidak boleh menandai seluruh isinya "hilang".

describe('portMarkAllowed', () => {
  it('port kosong yang memang belum berisi boleh diproses', () => {
    expect(portMarkAllowed(0, 0)).toBe(true);
  });

  it('port yang membaca 0 ONU padahal inventori ada isinya = TIDAK terbaca', () => {
    expect(portMarkAllowed(0, 12)).toBe(false);
  });

  it('port yang mengembalikan data boleh menandai sisanya hilang', () => {
    expect(portMarkAllowed(3, 12)).toBe(true);
    expect(portMarkAllowed(1, 1)).toBe(true);
  });
});

describe('saveInventory tidak lagi menghapus baris ONU', () => {
  const source = readFileSync(
    resolve(__dirname, '../src/app/modules/olt/olt.repository.ts'),
    'utf8',
  );

  it('tidak mengandung DELETE FROM olt_onus', () => {
    expect(source).not.toContain('DELETE FROM olt_onus');
  });

  it('memakai penanda missing_at dan mencabutnya saat ONU muncul lagi', () => {
    expect(source).toContain('missing_at = NOW()');
    expect(source).toContain('missing_at    = NULL');
  });

  it('riwayat menyertakan Nomor Internet pelanggan asal dan tujuan', () => {
    expect(source).toContain('from_internet_no');
    expect(source).toContain('to_internet_no');
  });

  it('ONU bertanda hilang tidak bisa dipasang', () => {
    expect(source).toContain('ONU_MISSING');
  });
});

describe('migrasi 031', () => {
  const sql = readFileSync(resolve(__dirname, '../migrations/031_olt_onu_missing.sql'), 'utf8');

  it('menambah kolom missing_at tanpa menghapus data', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS missing_at DATETIME NULL/);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('menambah indeks untuk meninjau ONU hilang', () => {
    expect(sql).toContain('idx_olt_onus_missing');
  });
});
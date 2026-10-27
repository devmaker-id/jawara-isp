import { describe, expect, it } from 'vitest';
import { parseCsv, splitSql, TOOLS_TABLES } from '../src/app/modules/tools/tools.service';

// Parser di sini menyentuh file yang diunggah operator, jadi kasus anehnya
// (koma dalam tanda kutip, kutip ganda, baris baru) harus benar — kalau salah,
// data masuk ke tabel yang salah tanpa error.

describe('parseCsv', () => {
  it('membaca baris judul dan data', () => {
    expect(parseCsv('id,name\n1,Budi\n2,Siti')).toEqual([
      ['id', 'name'],
      ['1', 'Budi'],
      ['2', 'Siti'],
    ]);
  });

  it('mempertahankan koma di dalam tanda kutip', () => {
    expect(parseCsv('id,alamat\n1,"Jl. Merdeka, No. 5"')).toEqual([
      ['id', 'alamat'],
      ['1', 'Jl. Merdeka, No. 5'],
    ]);
  });

  it('menerjemahkan kutip ganda ganda menjadi satu kutip', () => {
    expect(parseCsv('a\n"kata ""penting"""')).toEqual([['a'], ['kata "penting"']]);
  });

  it('mempertahankan baris baru di dalam tanda kutip', () => {
    expect(parseCsv('a,b\n"baris1\nbaris2",x')).toEqual([
      ['a', 'b'],
      ['baris1\nbaris2', 'x'],
    ]);
  });

  it('mengabaikan CR dari file Windows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('menangani sel kosong di ujung baris', () => {
    expect(parseCsv('a,b,c\n1,,')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });
});

describe('splitSql', () => {
  it('memisahkan pernyataan pada titik koma', () => {
    expect(splitSql('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('tidak memotong titik koma di dalam string', () => {
    expect(splitSql("INSERT INTO t VALUES ('a;b');")).toEqual(["INSERT INTO t VALUES ('a;b')"]);
  });

  it('membuang komentar baris', () => {
    expect(splitSql('-- komentar\nSELECT 1;')).toEqual(['SELECT 1']);
  });

  it('menjaga pernyataan terakhir tanpa titik koma', () => {
    expect(splitSql('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('mengabaikan isi kosong', () => {
    expect(splitSql('\n\n  \n')).toEqual([]);
  });
});

describe('daftar putih tabel', () => {
  it('tidak memuat tabel sistem MySQL', () => {
    for (const forbidden of ['mysql.user', 'information_schema.tables', 'users_privileges']) {
      expect(TOOLS_TABLES as readonly string[]).not.toContain(forbidden);
    }
  });

  it('memuat tabel inti RADIUS dan billing', () => {
    for (const table of ['customers', 'invoices', 'payments', 'radcheck', 'radacct']) {
      expect(TOOLS_TABLES as readonly string[]).toContain(table);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { csvCell, EXPORT_TYPES, ExportsService, toCsv } from '../src/app/modules/exports/exports.service';

describe('Ekspor CSV', () => {
  it('mengutip sel yang memuat koma, kutip, atau baris baru', () => {
    expect(csvCell('biasa')).toBe('biasa');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('kata "kutip"')).toBe('"kata ""kutip"""');
    expect(csvCell('baris\nbaru')).toBe('"baris\nbaru"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(1500)).toBe('1500');
    expect(csvCell(false)).toBe('0');
  });

  it('menyusun header dan baris sesuai spesifikasi kolom', () => {
    const csv = toCsv([{ id: 1, name: 'Budi', email: 'b@uji.test' }], 'customers');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('id,nama,email,telepon,alamat,aktif,dibuat');
    expect(lines[1].startsWith('1,Budi,b@uji.test')).toBe(true);
  });

  it('menolak jenis ekspor yang tidak dikenal', () => {
    const service = new ExportsService({} as never);
    expect(() => service.assertType('ngawur')).toThrow(NotFoundException);
    expect(service.assertType('invoices')).toBe('invoices');
    expect(EXPORT_TYPES).toEqual(['customers', 'invoices', 'payments']);
  });

  it('melaporkan batas baris ekspor secara eksplisit', () => {
    const service = new ExportsService({} as never);
    expect(service.rowLimit).toBe(5000);
  });
});
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  DEFAULT_TEMPLATES,
  MAX_TEMPLATES,
  parseTemplates,
  TemplateValidationError,
  validateTemplates,
} from '../src/app/modules/profiles/voucher-template';

const row = (extra: Record<string, unknown> = {}) => ({
  name: 'Uji',
  header: '{{brand}}',
  title: 'Voucher {{profile}}',
  lines: ['Harga {{price}}'],
  footer: '{{printed_at}}',
  ...extra,
});

const validate = (rows: unknown[]) => validateTemplates(JSON.stringify(rows));

describe('validasi template voucher (input dari form admin)', () => {
  it('menerima template sah dan melengkapi default', () => {
    const [template] = validate([row()]);
    expect(template.name).toBe('Uji');
    expect(template.enabled).toBe(true);
    expect(template.layout).toEqual(DEFAULT_LAYOUT);
    expect(template.lines).toEqual(['Harga {{price}}']);
  });

  it('id dibuat dari nama dan tetap unik', () => {
    const list = validate([row({ name: 'Sama' }), row({ name: 'Sama' })]);
    expect(list.map((item) => item.id)).toEqual(['sama', 'sama-2']);
  });

  it('menolak tag HTML/script di semua kolom teks', () => {
    for (const field of ['name', 'header', 'title', 'footer']) {
      expect(() => validate([row({ [field]: '<script>alert(1)</script>' })]))
        .toThrow(TemplateValidationError);
    }
    expect(() => validate([row({ lines: ['<img src=x onerror=alert(1)>'] })])).toThrow(
      TemplateValidationError,
    );
  });

  it('menolak variabel di luar daftar putih', () => {
    expect(() => validate([row({ title: 'Halo {{hacker}}' })])).toThrow(/tidak dikenal/);
    expect(() => validate([row({ title: 'Halo {{brand}' })])).toThrow(/tidak lengkap/);
  });

  it('membatasi jumlah baris, panjang teks, dan jumlah template', () => {
    expect(() => validate([row({ lines: ['a', 'b', 'c', 'd'] })])).toThrow(/maksimal 3/);
    expect(() => validate([row({ name: 'x'.repeat(41) })])).toThrow(/maksimal 40/);
    expect(() => validate(Array.from({ length: MAX_TEMPLATES + 1 }, () => row()))).toThrow(
      /Maksimal 20/,
    );
  });

  it('menolak layout di luar batas', () => {
    expect(() => validate([row({ layout: { columns: 4 } })])).toThrow(/columns/);
    expect(() => validate([row({ layout: { marginMm: 1 } })])).toThrow(/marginMm/);
    expect(() => validate([row({ layout: { gapMm: 40 } })])).toThrow(/gapMm/);
  });

  it('menolak JSON rusak, array kosong, dan template kosong', () => {
    expect(() => validateTemplates('bukan json')).toThrow(TemplateValidationError);
    expect(() => validateTemplates('[]')).toThrow(/Minimal satu/);
    expect(() =>
      validateTemplates(JSON.stringify([{ name: 'Kosong', header: '', title: '', lines: [], footer: '' }])),
    ).toThrow(/tidak boleh kosong semua/);
  });

  it('menerima status nonaktif', () => {
    const [template] = validate([row({ enabled: false })]);
    expect(template.enabled).toBe(false);
  });

  it('data rusak saat dibaca tidak menggagalkan pencetakan', () => {
    expect(parseTemplates('{{{')).toEqual(DEFAULT_TEMPLATES);
    expect(parseTemplates(null)).toEqual(DEFAULT_TEMPLATES);
    expect(parseTemplates(JSON.stringify([row({ enabled: false })]))[0].enabled).toBe(false);
  });
});
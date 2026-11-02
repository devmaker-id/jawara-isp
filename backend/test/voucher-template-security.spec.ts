import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  DEFAULT_TEMPLATES,
  MAX_TEMPLATES,
  parseTemplates,
  TemplateValidationError,
  validateTemplates,
} from '../src/app/modules/profiles/voucher-template';

const html = '<div class="card"><h2>{{profile}}</h2><div>{{username}} / {{password}}</div></div>';

const row = (extra: Record<string, unknown> = {}) => ({ name: 'Uji', html, ...extra });

const validate = (rows: unknown[]) => validateTemplates(JSON.stringify(rows));

describe('validasi template voucher HTML (input dari editor admin)', () => {
  it('menerima HTML sah dan melengkapi default', () => {
    const [template] = validate([row()]);
    expect(template.name).toBe('Uji');
    expect(template.enabled).toBe(true);
    expect(template.layout).toEqual(DEFAULT_LAYOUT);
    expect(template.html).toContain('{{profile}}');
  });

  it('id dibuat dari nama dan tetap unik', () => {
    expect(validate([row({ name: 'Sama' }), row({ name: 'Sama' })]).map((t) => t.id)).toEqual([
      'sama',
      'sama-2',
    ]);
  });

  it('menolak script, iframe, form, svg, dan gambar', () => {
    const bad = [
      '<script>alert(1)</script>',
      '<iframe src="https://jahat"></iframe>',
      '<form action="/x"></form>',
      '<svg onload="alert(1)"></svg>',
      '<img src="https://jahat/x.png">',
      '<link rel="stylesheet" href="https://jahat/x.css">',
    ];
    for (const markup of bad) {
      expect(() => validate([row({ html: markup })])).toThrow(TemplateValidationError);
    }
  });

  it('menolak atribut event, url() CSS, javascript: dan data:', () => {
    const bad = [
      '<div onclick="alert(1)">x</div>',
      '<div style="background:url(https://jahat/x.png)">x</div>',
      '<a href="javascript:alert(1)">x</a>',
      '<div style="background:data:image/png;base64,AAA">x</div>',
      '<style>@import url("https://jahat/x.css");</style>',
    ];
    for (const markup of bad) {
      expect(() => validate([row({ html: markup })])).toThrow(TemplateValidationError);
    }
  });

  it('menolak variabel di luar daftar putih', () => {
    expect(() => validate([row({ html: '<p>{{hacker}}</p>' })])).toThrow(/tidak dikenal/);
    expect(() => validate([row({ html: '<p>{{brand}</p>' })])).toThrow(/tidak lengkap/);
  });

  it('membatasi panjang HTML, jumlah template, dan layout', () => {
    expect(() => validate([row({ html: `<p>${'x'.repeat(200_001)}</p>` })])).toThrow(/maksimal 200000/);
    // Template panjang (1.000 baris) harus diterima, bukan dipotong.
    const long = Array.from({ length: 1000 }, (_, i) => `<div class="row">Baris ${i} {{username}}</div>`).join('\n');
    const [accepted] = validate([row({ html: long })]);
    expect(accepted.html.split('\n')).toHaveLength(1000);
    // Total config dibatasi kapasitas kolom TEXT (65 KB), bukan per template saja.
    const big = `<p>${'y'.repeat(190_000)}</p>`;
    expect(() =>
      validate([row({ name: 'A', html: big }), row({ name: 'B', html: big }), row({ name: 'C', html: big })]),
    ).toThrow(/Total ukuran semua template/);
    expect(() => validate([row({ html: long })])).not.toThrow();
    expect(() => validate(Array.from({ length: MAX_TEMPLATES + 1 }, () => row()))).toThrow(/Maksimal 20/);
    expect(() => validate([row({ layout: { columns: 4 } })])).toThrow(/columns/);
    expect(() => validate([row({ layout: { marginMm: 1 } })])).toThrow(/marginMm/);
    expect(() => validate([row({ layout: { gapMm: 40 } })])).toThrow(/gapMm/);
  });

  it('menolak JSON rusak, array kosong, dan HTML kosong', () => {
    expect(() => validateTemplates('bukan json')).toThrow(/bukan JSON/);
    expect(() => validateTemplates('[]')).toThrow(/Minimal satu/);
    expect(() => validate([row({ html: '   ' })])).toThrow(/wajib diisi/);
  });

  it('mengubah template lama (header/title/lines) menjadi HTML', () => {
    const [template] = validate([
      {
        name: 'Lama',
        header: '{{brand}}',
        title: 'Voucher {{profile}}',
        lines: ['Harga {{price}}'],
        footer: '{{printed_at}}',
      },
    ]);
    expect(template.html).toContain('{{brand}}');
    expect(template.html).toContain('Harga {{price}}');
    expect(template.html).toContain('class="card"');
  });

  it('menerima status nonaktif dan data rusak saat dibaca memakai bawaan', () => {
    expect(validate([row({ enabled: false })])[0].enabled).toBe(false);
    expect(parseTemplates('{{{')).toEqual(DEFAULT_TEMPLATES);
    expect(parseTemplates(null)).toEqual(DEFAULT_TEMPLATES);
  });
});
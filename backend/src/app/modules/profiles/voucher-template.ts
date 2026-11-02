/**
 * Template kartu voucher — HTML/CSS bebas (satu "berkas" per template).
 *
 * Template dirender di BROWSER admin (iframe sandbox tanpa script). Server tidak
 * pernah merender HTML: ia hanya menyimpan, memvalidasi, dan membagikannya ke
 * panel. Karena itu mesin PDF bawaan (voucher-pdf.ts) tetap memakai template
 * teks internal untuk WhatsApp.
 *
 * KEAMANAN: `html` adalah input tidak tepercaya dari form admin.
 *   - tag aktif (script/iframe/object/embed/form/link/meta/base/svg/math/img)
 *     DITOLAK, bukan dibersihkan diam-diam,
 *   - atribut event (on*=), skema `javascript:`/`data:`, `url()`, `@import`,
 *     dan `expression()` DITOLAK — tidak ada jalan memuat sumber luar,
 *   - variabel hanya `{{nama}}` dari daftar putih,
 *   - panjang, jumlah template, dan layout dibatasi.
 * Sisi klien menjalankan sanitasi kedua (DOMParser + allowlist) sebelum HTML
 * masuk iframe sandbox, supaya data lama yang tersimpan tetap aman.
 */

export interface VoucherTemplateLayout {
  /** Kolom kartu per halaman: 1-3. */
  columns: 1 | 2 | 3;
  /** Margin halaman dalam milimeter: 5-24. */
  marginMm: number;
  /** Jarak antar kartu dalam milimeter: 2-15. */
  gapMm: number;
}

export interface VoucherTemplate {
  id: string;
  name: string;
  /** HTML + CSS kartu; boleh memakai variabel {{...}}. */
  html: string;
  /** Hanya template aktif yang ditawarkan saat mencetak voucher. */
  enabled: boolean;
  layout: VoucherTemplateLayout;
}

/** Bentuk teks untuk mesin PDF bawaan (WhatsApp / cadangan server). */
export interface VoucherTextTemplate {
  header: string;
  title: string;
  lines: string[];
  footer: string;
}

export const MAX_TEMPLATES = 20;
export const MAX_HTML = 6000;
const MAX_NAME = 40;

export const DEFAULT_LAYOUT: VoucherTemplateLayout = { columns: 3, marginMm: 8.5, gapMm: 3.5 };

export const TEMPLATE_VARIABLES: Array<{ token: string; label: string }> = [
  { token: '{{brand}}', label: 'Nama brand (Pengaturan → Branding)' },
  { token: '{{tagline}}', label: 'Tagline brand' },
  { token: '{{profile}}', label: 'Nama profil voucher/member' },
  { token: '{{profile_type}}', label: 'hotspot atau ppp' },
  { token: '{{user_type}}', label: 'voucher atau member' },
  { token: '{{username}}', label: 'Username voucher' },
  { token: '{{password}}', label: 'Password voucher' },
  { token: '{{price}}', label: 'Harga + pajak (Rupiah)' },
  { token: '{{owner}}', label: 'Nama pemilik voucher' },
  { token: '{{created_by}}', label: 'Nama pembuat voucher' },
  { token: '{{customer}}', label: 'Nama pelanggan (akun member)' },
  { token: '{{status}}', label: 'Status voucher' },
  { token: '{{expires}}', label: 'Tanggal kedaluwarsa' },
  { token: '{{created_at}}', label: 'Tanggal voucher dibuat' },
  { token: '{{printed_at}}', label: 'Tanggal cetak' },
];

const VARIABLE_NAMES = new Set(TEMPLATE_VARIABLES.map((item) => item.token.slice(2, -2)));

/** Template teks untuk mesin PDF server (tidak bisa merender HTML). */
export const FALLBACK_TEXT_TEMPLATE: VoucherTextTemplate = {
  header: '{{brand}}',
  title: 'Voucher {{profile}}',
  lines: ['Harga {{price}}', 'Pemilik {{owner}}'],
  footer: 'Masa aktif mulai login pertama',
};

const CARD_CSS = `<style>
.card{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border:1px dashed #94a3b8;border-radius:6px;padding:10px;break-inside:avoid;color:#0f172a}
.brand{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
h2{font-size:13px;margin:2px 0 4px}
.row{font-size:10px;color:#334155}
</style>`;

const card = (body: string): string => `${CARD_CSS}\n<div class="card">\n${body}\n</div>`;

export const DEFAULT_TEMPLATES: VoucherTemplate[] = [
  {
    id: 'klasik',
    name: 'Klasik',
    html: card(
      [
        '<div class="brand">{{brand}}</div>',
        '<h2>{{profile}}</h2>',
        '<div class="row">Harga {{price}} · Pemilik {{owner}}</div>',
        '<div class="row">{{username}} / {{password}}</div>',
        '<div class="brand">{{printed_at}}</div>',
      ].join('\n'),
    ),
    enabled: true,
    layout: DEFAULT_LAYOUT,
  },
  {
    id: 'ringkas',
    name: 'Ringkas',
    html: card(
      [
        '<div class="brand">{{brand}} · {{profile_type}}</div>',
        '<h2>{{profile}} · {{price}}</h2>',
        '<div class="row">{{username}} / {{password}}</div>',
        '<div class="brand">{{printed_at}}</div>',
      ].join('\n'),
    ),
    enabled: true,
    layout: DEFAULT_LAYOUT,
  },
  {
    id: 'reseller',
    name: 'Reseller',
    html: card(
      [
        '<div class="brand">{{brand}}</div>',
        '<h2>{{profile}}</h2>',
        '<div class="row">{{username}} / {{password}}</div>',
        '<div class="row">Harga {{price}} · Reseller {{owner}}</div>',
        '<div class="brand">{{printed_at}}</div>',
      ].join('\n'),
    ),
    enabled: true,
    layout: DEFAULT_LAYOUT,
  },
];

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Pola yang tidak boleh ada di template. Ditolak, bukan dibersihkan. */
const BANNED: Array<[RegExp, string]> = [
  [
    /<\s*\/?\s*(script|iframe|object|embed|form|input|button|link|meta|base|svg|math|img|video|audio|source)\b/i,
    'tag aktif (script/iframe/form/svg/img dan sejenis)',
  ],
  [/<\s*style[^>]*>[^<]*@import/i, '@import di CSS'],
  [/javascript\s*:|vbscript\s*:|data\s*:/i, 'URL skema javascript:/vbscript:/data:'],
  [/\son[a-z]+\s*=/i, 'atribut event on...='],
  [/url\s*\(/i, 'url() di CSS (sumber luar)'],
  [/expression\s*\(/i, 'CSS expression()'],
  [/<\?|<!doctype|<!\[cdata/i, 'deklarasi dokumen'],
];

function checkHtml(raw: unknown, field: string): string {
  if (typeof raw !== 'string') throw new TemplateValidationError(`${field}: HTML harus berupa teks.`);
  const html = raw.replace(CONTROL_CHARS, '').trim();
  if (!html) throw new TemplateValidationError(`${field}: HTML wajib diisi.`);
  if (html.length > MAX_HTML) {
    throw new TemplateValidationError(`${field}: HTML maksimal ${MAX_HTML} karakter.`);
  }
  for (const [pattern, label] of BANNED) {
    if (pattern.test(html)) throw new TemplateValidationError(`${field}: tidak boleh memuat ${label}.`);
  }
  return html;
}

function assertKnownVariables(html: string, field: string): void {
  for (const token of html.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? []) {
    const name = token.slice(2, -2).trim().toLowerCase();
    if (!VARIABLE_NAMES.has(name)) {
      throw new TemplateValidationError(
        `${field}: variabel tidak dikenal ${token}. Gunakan daftar variabel di editor.`,
      );
    }
  }
  const rest = html.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '');
  if (/\{\{/.test(rest)) {
    throw new TemplateValidationError(`${field}: penulisan {{...}} tidak lengkap.`);
  }
}

function cleanLayout(value: unknown): VoucherTemplateLayout {
  const row = (value ?? {}) as Record<string, unknown>;
  const columns = Number(row.columns ?? DEFAULT_LAYOUT.columns);
  const marginMm = Number(row.marginMm ?? DEFAULT_LAYOUT.marginMm);
  const gapMm = Number(row.gapMm ?? DEFAULT_LAYOUT.gapMm);
  if (![1, 2, 3].includes(columns)) throw new TemplateValidationError('layout.columns harus 1, 2, atau 3.');
  if (!Number.isFinite(marginMm) || marginMm < 5 || marginMm > 24) {
    throw new TemplateValidationError('layout.marginMm harus antara 5 dan 24.');
  }
  if (!Number.isFinite(gapMm) || gapMm < 2 || gapMm > 15) {
    throw new TemplateValidationError('layout.gapMm harus antara 2 dan 15.');
  }
  return { columns: columns as 1 | 2 | 3, marginMm, gapMm };
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'template';

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Template lama (header/title/lines/footer) → HTML kartu yang setara. */
function legacyToHtml(row: Record<string, unknown>): string {
  const lines = Array.isArray(row.lines) ? row.lines.map((line) => String(line ?? '')).slice(0, 3) : [];
  return card(
    [
      row.header ? `<div class="brand">${esc(row.header)}</div>` : '',
      row.title ? `<h2>${esc(row.title)}</h2>` : '',
      ...lines.filter(Boolean).map((line) => `<div class="row">${esc(line)}</div>`),
      row.footer ? `<div class="brand">${esc(row.footer)}</div>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/**
 * Validasi ketat untuk PENYIMPANAN. Melempar TemplateValidationError bila ada
 * yang tidak memenuhi aturan.
 */
export function validateTemplates(raw: string | undefined | null): VoucherTemplate[] {
  if (raw === undefined || raw === null || raw.trim() === '') {
    throw new TemplateValidationError('Daftar template voucher tidak boleh kosong.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TemplateValidationError('voucher_templates bukan JSON yang valid.');
  }
  if (!Array.isArray(parsed)) throw new TemplateValidationError('voucher_templates harus berupa array.');
  if (parsed.length === 0) throw new TemplateValidationError('Minimal satu template voucher harus ada.');
  if (parsed.length > MAX_TEMPLATES) {
    throw new TemplateValidationError(`Maksimal ${MAX_TEMPLATES} template voucher.`);
  }

  const used = new Set<string>();
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TemplateValidationError(`Template ke-${index + 1} bukan objek.`);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || !row.name.trim()) {
      throw new TemplateValidationError(`Template ke-${index + 1}: nama wajib diisi.`);
    }
    const name = row.name.replace(CONTROL_CHARS, '').trim().slice(0, MAX_NAME);
    if (/[<>]/.test(name)) throw new TemplateValidationError(`${name}: nama tidak boleh memuat < atau >.`);

    let id = slug(name);
    let suffix = 2;
    while (used.has(id)) id = `${slug(name)}-${suffix++}`;
    used.add(id);

    const html = checkHtml(row.html ?? legacyToHtml(row), name);
    assertKnownVariables(html, name);

    return {
      id,
      name,
      html,
      enabled: row.enabled === undefined ? true : row.enabled === true,
      layout: cleanLayout(row.layout),
    };
  });
}

/**
 * JSON dari config → daftar template untuk DIBACA. Nilai rusak tidak
 * menggagalkan halaman: dipakai template bawaan.
 */
export function parseTemplates(raw: string | undefined | null): VoucherTemplate[] {
  try {
    return validateTemplates(raw);
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

/** Ganti `{{variabel}}` dengan nilainya; token tak dikenal dibiarkan apa adanya. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}
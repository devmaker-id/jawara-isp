/**
 * Cetak voucher dari browser (tanpa render HTML di server).
 *
 * Template HTML/CSS berasal dari admin. Sebelum masuk iframe, HTML dibersihkan
 * DENGAN ALLOWLIST: tag aktif dibuang, atribut selain class/style dilepas, dan
 * url()/@import di CSS dihapus. Server juga menolak pola ini saat menyimpan —
 * ini lapisan kedua untuk data lama atau perubahan bentuk penyimpanan.
 */

export interface VoucherPrintBrand {
  brand: string;
  tagline: string;
}

export interface VoucherPrintCard {
  profile: string;
  profile_type: string;
  user_type: string;
  username: string;
  password: string;
  price: string;
  owner: string;
  created_by: string;
  customer: string;
  status: string;
  expires: string;
  created_at: string;
}

export interface VoucherPrintLayout {
  columns: number;
  marginMm: number;
  gapMm: number;
}

const ALLOWED_ATTRS = new Set(['class', 'style', 'colspan', 'rowspan']);
const DENIED_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'img',
  'video',
  'audio',
  'source',
]);

/** Bersihkan HTML template sebelum dirender di iframe sandbox. */
export function sanitizeTemplateHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('*').forEach((element) => {
    if (DENIED_TAGS.has(element.tagName.toLowerCase())) {
      element.remove();
      return;
    }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
        element.removeAttribute(attr.name);
      } else if (/javascript:|vbscript:|data:|expression\s*\(|@import/i.test(value)) {
        element.removeAttribute(attr.name);
      } else if (/url\s*\(/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
  });
  doc.body.querySelectorAll('style').forEach((style) => {
    style.textContent = (style.textContent ?? '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/url\s*\([^)]*\)/gi, 'none')
      .replace(/expression\s*\([^)]*\)/gi, 'none');
  });
  return doc.body.innerHTML;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ganti {{variabel}} dengan nilai kartu. Nilai di-escape (teks, bukan HTML). */
export function fillCard(html: string, card: VoucherPrintCard, brand: VoucherPrintBrand, printedAt: string): string {
  const vars: Record<string, string> = { ...card, brand: brand.brand, tagline: brand.tagline, printed_at: printedAt };
  return html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : escapeHtml(value);
  });
}

/**
 * Dokumen cetak lengkap: satu halaman A4 berisi grid kartu sebanyak `columns`
 * kolom. `break-inside: avoid` menjaga kartu tidak terbelah antar halaman.
 */
export function buildPrintDocument(
  templateHtml: string,
  cards: VoucherPrintCard[],
  layout: VoucherPrintLayout,
  brand: VoucherPrintBrand,
  printedAt: string,
): string {
  const cardHtml = sanitizeTemplateHtml(templateHtml);
  const cols = Math.min(3, Math.max(1, Math.round(layout.columns || 3)));
  const body = cards
    .map((card) => `<div class="v-card">${fillCard(cardHtml, card, brand, printedAt)}</div>`)
    .join('\n');

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Voucher</title>
<style>
@page{size:A4;margin:${layout.marginMm}mm}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#0f172a}
.sheet{display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${layout.gapMm}mm}
.v-card{break-inside:avoid;page-break-inside:avoid;min-width:0}
@media screen{body{padding:8px;background:#e2e8f0}.sheet{background:#fff;padding:${layout.marginMm}mm}}
</style></head>
<body><div class="sheet">
${body}
</div></body></html>`;
}

/** Cetak dokumen lewat iframe tersembunyi (dialog print browser). */
export function printHtmlDocument(html: string): void {
  const existing = document.getElementById('voucher-print-frame');
  existing?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'voucher-print-frame';
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  // Tanpa allow-scripts: dokumen cetak tidak boleh menjalankan script apa pun.
  frame.setAttribute('sandbox', 'allow-modals');
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

/** Cermin validasi server untuk editor; kembalikan daftar pesan kesalahan. */
export function templateProblems(
  template: { name: string; html: string; layout: VoucherPrintLayout },
  variables: Array<{ token: string }>,
): string[] {
  const out: string[] = [];
  const known = new Set(variables.map((item) => item.token.slice(2, -2).toLowerCase()));
  if (!template.name.trim()) out.push('Nama template wajib diisi.');
  if (template.name.length > 40) out.push('Nama template maksimal 40 karakter.');
  if (/[<>]/.test(template.name)) out.push('Nama tidak boleh memuat < atau >.');
  if (!template.html.trim()) out.push('Kode HTML wajib diisi.');
  if (template.html.length > 6000) out.push('HTML maksimal 6000 karakter.');

  const banned: Array<[RegExp, string]> = [
    [/<\s*\/?\s*(script|iframe|object|embed|form|input|button|link|meta|base|svg|math|img|video|audio|source)\b/i, 'tag aktif (script/iframe/form/svg/img)'],
    [/javascript\s*:|vbscript\s*:|data\s*:/i, 'URL javascript:/data:'],
    [/\son[a-z]+\s*=/i, 'atribut event on...='],
    [/url\s*\(/i, 'url() di CSS'],
    [/@import/i, '@import di CSS'],
  ];
  for (const [pattern, label] of banned) {
    if (pattern.test(template.html)) out.push(`HTML tidak boleh memuat ${label}.`);
  }

  for (const match of template.html.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? []) {
    if (!known.has(match.slice(2, -2).trim().toLowerCase())) {
      out.push(`Variabel ${match} tidak dikenal.`);
    }
  }
  if (/\{\{/.test(template.html.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, ''))) {
    out.push('Penulisan {{...}} tidak lengkap.');
  }

  if (![1, 2, 3].includes(template.layout.columns)) out.push('Kolom harus 1, 2, atau 3.');
  if (template.layout.marginMm < 5 || template.layout.marginMm > 24) out.push('Margin halaman harus 5-24 mm.');
  if (template.layout.gapMm < 2 || template.layout.gapMm > 15) out.push('Jarak antar kartu harus 2-15 mm.');
  return [...new Set(out)];
}

/** Format nilai kartu dari baris voucher (sama dengan mesin PDF server). */
export function cardFromRow(
  row: {
    profile_name: string;
    profile_type?: string;
    user_type?: string;
    username: string;
    password: string;
    price?: number | string;
    tax_amount?: number | string;
    owner_name?: string | null;
    created_by_name?: string | null;
    customer_name?: string | null;
    status?: string;
    expires_at?: string | null;
    created_at?: string | null;
  },
  now: Date = new Date(),
): VoucherPrintCard {
  const stamp = (value?: string | null) =>
    value ? new Date(value).toLocaleDateString('id-ID', { dateStyle: 'short' }) : '-';
  return {
    profile: row.profile_name,
    profile_type: row.profile_type ?? '',
    user_type: row.user_type === 'member' ? 'member' : 'voucher',
    username: row.username,
    password: row.password === row.username ? '' : row.password,
    price: `Rp ${(Number(row.price ?? 0) + Number(row.tax_amount ?? 0)).toLocaleString('id-ID')}`,
    owner: row.owner_name ?? '-',
    created_by: row.created_by_name ?? '-',
    customer: row.customer_name ?? '-',
    status: row.status ?? '',
    expires: stamp(row.expires_at),
    created_at: stamp(row.created_at),
  };
}
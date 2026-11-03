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
  /** Satu kode bila username = password, selain itu "username · password". */
  credential: string;
  /** Harga + pajak sebagai angka (untuk logika warna di template). */
  price_value: number;
  /** Label ringkas: 2k, 3k, 5k, 10k, dst. */
  price_tier: string;
}

export interface VoucherPrintLayout {
  columns: number;
  marginMm: number;
  gapMm: number;
  /** Orientasi kertas; kosong = potret. */
  orientation?: 'portrait' | 'landscape';
  /** Baris per halaman; 0/kosong = kartu mengalir tanpa pemenggalan. */
  rows?: number;
}

/**
 * Warna bawaan menurut nominal. Template boleh menimpanya sendiri lewat CSS,
 * mis. `.v-card[data-price="2000"] .harga{background:#2563eb}`.
 */
const TIER_COLORS: Array<{ max: number; color: string }> = [
  { max: 4_999, color: '#64748b' },
  { max: 9_999, color: '#16a34a' },
  { max: 19_999, color: '#2563eb' },
  { max: 24_999, color: '#d97706' },
  { max: Number.POSITIVE_INFINITY, color: '#7c3aed' },
];

export function tierColor(price: number): string {
  return TIER_COLORS.find((tier) => price <= tier.max)?.color ?? '#64748b';
}

/** Label ringkas nominal: 2000 → "2k", 12500 → "12,5k". */
export function tierLabel(price: number): string {
  const thousands = price / 1000;
  const text = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1).replace('.', ',');
  return `${text}k`;
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
  const vars: Record<string, string> = {
    ...Object.fromEntries(Object.entries(card).map(([key, value]) => [key, String(value)])),
    brand: brand.brand,
    tagline: brand.tagline,
    printed_at: printedAt,
  };
  return html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : escapeHtml(value);
  });
}

/**
 * Dokumen cetak lengkap.
 *
 * Bila `layout.rows` diisi, kartu dipenggal per halaman (kolom × baris) sehingga
 * jumlah per lembar pasti — mis. A4 potret 6×5 = 30 kartu, lanskap 10×6 = 60.
 * Tanpa `rows`, perilaku lama dipertahankan: satu grid mengalir.
 */
export function buildPrintDocument(
  templateHtml: string,
  cards: VoucherPrintCard[],
  layout: VoucherPrintLayout,
  brand: VoucherPrintBrand,
  printedAt: string,
): string {
  const cardHtml = sanitizeTemplateHtml(templateHtml);
  const cols = Math.min(10, Math.max(1, Math.round(layout.columns || 3)));
  const rows = Math.min(12, Math.max(0, Math.round(layout.rows ?? 0)));
  const orientation = layout.orientation === 'landscape' ? 'landscape' : 'portrait';

  const renderCard = (card: VoucherPrintCard) =>
    `<div class="v-card" data-price="${card.price_value}" data-tier="${card.price_tier}" ` +
    `style="--tier-color:${tierColor(card.price_value)}">${fillCard(cardHtml, card, brand, printedAt)}</div>`;

  let sheets: string;
  if (rows > 0 && cards.length > 0) {
    const perPage = cols * rows;
    const pages: VoucherPrintCard[][] = [];
    for (let index = 0; index < cards.length; index += perPage) {
      pages.push(cards.slice(index, index + perPage));
    }
    sheets = pages
      .map(
        (page, index) =>
          `<div class="sheet${index === pages.length - 1 ? ' last' : ''}">${page.map(renderCard).join('\n')}</div>`,
      )
      .join('\n');
  } else {
    sheets = `<div class="sheet last">${cards.map(renderCard).join('\n')}</div>`;
  }

  // Tinggi baris dihitung dari tinggi kertas agar kolom × baris benar-benar
  // muat satu halaman, bukan bergantung pada isi kartu.
  const paperHeight = orientation === 'landscape' ? 210 : 297;
  const usable = paperHeight - layout.marginMm * 2;
  const rowRule =
    rows > 0
      ? `grid-auto-rows:${((usable - (rows - 1) * layout.gapMm) / rows).toFixed(2)}mm;`
      : '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Voucher</title>
<style>
@page{size:A4 ${orientation};margin:${layout.marginMm}mm}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#0f172a}
.sheet{display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));${rowRule}gap:${layout.gapMm}mm}
.sheet:not(.last){break-after:page;page-break-after:always}
.v-card{break-inside:avoid;page-break-inside:avoid;min-width:0;${rows > 0 ? 'overflow:hidden;' : ''}}
@media screen{body{padding:8px;background:#e2e8f0}.sheet{background:#fff;padding:${layout.marginMm}mm;margin-bottom:12px}}
</style></head>
<body>
${sheets}
</body></html>`;
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
  if (template.html.length > 200_000) out.push('HTML maksimal 200.000 karakter (beberapa ribu baris).');

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
  const priceValue = Number(row.price ?? 0) + Number(row.tax_amount ?? 0);
  return {
    profile: row.profile_name,
    profile_type: row.profile_type ?? '',
    user_type: row.user_type === 'member' ? 'member' : 'voucher',
    username: row.username,
    password: row.password === row.username ? '' : row.password,
    price: `Rp ${priceValue.toLocaleString('id-ID')}`,
    owner: row.owner_name ?? '-',
    created_by: row.created_by_name ?? '-',
    customer: row.customer_name ?? '-',
    status: row.status ?? '',
    expires: stamp(row.expires_at),
    created_at: stamp(row.created_at),
    // Voucher dengan username = password hanya menampilkan satu kode, supaya
    // tidak ada garis miring atau baris kosong di kartu.
    credential:
      row.password === row.username ? row.username : `${row.username} · ${row.password}`,
    price_value: priceValue,
    price_tier: tierLabel(priceValue),
  };
}
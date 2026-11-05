/**
 * Cetak voucher dari browser (tanpa render HTML di server).
 *
 * Template HTML/CSS berasal dari admin. Sebelum masuk iframe, HTML dibersihkan
 * DENGAN ALLOWLIST: tag aktif dibuang, atribut selain class/style dilepas, dan
 * url()/@import di CSS dihapus. Server juga menolak pola ini saat menyimpan —
 * ini lapisan kedua untuk data lama atau perubahan bentuk penyimpanan.
 *
 * Layout bersifat FLUID (grid mengalir), bukan kolom×baris yang dipatok: setiap
 * kartu punya lebar dasar (mm) yang bisa di-scale, lalu sheet me-wrap kartu
 * sesuai lebar kertas/margin. Ganti kertas/margin/scale tidak mengubah skala
 * ulang atau memotong kartu — kartu hanya berpindah baris.
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

export type PaperKind = 'a4' | 'a5' | 'thermal58' | 'thermal80' | 'custom';

export interface PaperSpec {
  kind: PaperKind;
  /** Lebar kertas dalam milimeter. */
  widthMm: number;
  /** Tinggi kertas; null = gulungan (thermal) tanpa batas tinggi. */
  heightMm: number | null;
}

export const PAPER_PRESETS: Record<Exclude<PaperKind, 'custom'>, PaperSpec> = {
  a4: { kind: 'a4', widthMm: 210, heightMm: 297 },
  a5: { kind: 'a5', widthMm: 148, heightMm: 210 },
  thermal58: { kind: 'thermal58', widthMm: 58, heightMm: null },
  thermal80: { kind: 'thermal80', widthMm: 80, heightMm: null },
};

export interface VoucherPrintLayout {
  /** Margin halaman dalam milimeter. */
  marginMm: number;
  /** Jarak antar kartu dalam milimeter. */
  gapMm: number;
  /** Orientasi kertas; kosong = potret. */
  orientation?: 'portrait' | 'landscape';
  /** Ukuran kertas; kosong = A4. */
  paper?: PaperSpec;
  /** Lebar DASAR kartu dalam mm (sebelum scale); kosong = 64 (~240px). */
  cardWidthMm?: number;
  /** Skala kartu (perbesar/perkecil, ikut TERCETAK); default 1. */
  scale?: number;
  /** Tampilkan garis potong pada setiap kartu. */
  cutLines?: boolean;
}

/** Lebar dasar kartu voucher (mm). Sekitar 240px — cukup untuk satu voucher. */
export const DEFAULT_CARD_WIDTH_MM = 64;

export interface PrintMetrics {
  paper: PaperSpec;
  orientation: 'portrait' | 'landscape';
  /** Baris yang muat per lebar kertas (diturunkan, bukan input). */
  columns: number;
  usableWidthMm: number;
  usableHeightMm: number;
  /** Lebar dasar kartu (mm, sebelum scale) setelah di-clamp. */
  cardWidthMm: number;
  /** Skala kartu setelah di-clamp. */
  scale: number;
  /** Lebar kartu efektif setelah scale (mm). */
  effectiveCardWidthMm: number;
  gapMm: number;
}

export const mmToPx = (mm: number): number => Math.round(mm * 3.7795275591);

const clamp = (value: number, min: number, max: number, fallback: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isFinite(rounded) ? Math.min(max, Math.max(min, rounded)) : fallback;
};

/** Ukuran kertas efektif setelah orientasi diterapkan. */
export function resolvePaper(layout: VoucherPrintLayout): PaperSpec {
  const base = layout.paper ?? PAPER_PRESETS.a4;
  const landscape = layout.orientation === 'landscape' && base.heightMm !== null;
  return landscape ? { ...base, widthMm: base.heightMm as number, heightMm: base.widthMm } : base;
}

/**
 * Hitung metrik cetak dari konfigurasi sebenarnya. Tanpa kolom×baris yang
 * dipatok: jumlah kartu per baris dihitung dari lebar kertas vs lebar kartu
 * (yang sudah di-scale). Gulungan thermal selalu satu kolom selebar rol.
 */
export function printMetrics(_cardCount: number, layout: VoucherPrintLayout): PrintMetrics {
  const paper = resolvePaper(layout);
  const margin = clamp(Number(layout.marginMm) || 8, 5, 24, 8);
  const gap = clamp(Number(layout.gapMm ?? 3), 0, 15, 3);
  const scale = clamp(Number(layout.scale ?? 1), 0.5, 2, 1);
  const base = clamp(Number(layout.cardWidthMm ?? DEFAULT_CARD_WIDTH_MM), 15, 300, DEFAULT_CARD_WIDTH_MM);

  const usableWidthMm = Math.max(10, paper.widthMm - margin * 2);
  const usableHeightMm = paper.heightMm === null ? 0 : Math.max(10, paper.heightMm - margin * 2);

  const effectiveCardWidthMm = Math.min(base * scale, usableWidthMm);
  const columns =
    paper.heightMm === null
      ? 1
      : Math.max(1, Math.floor((usableWidthMm + gap) / (effectiveCardWidthMm + gap)));

  const orientation: 'portrait' | 'landscape' =
    paper.heightMm === null ? 'portrait' : paper.widthMm > paper.heightMm ? 'landscape' : 'portrait';

  return {
    paper,
    orientation,
    columns,
    usableWidthMm,
    usableHeightMm,
    cardWidthMm: base,
    scale,
    effectiveCardWidthMm,
    gapMm: gap,
  };
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
 * Dokumen cetak lengkap (fluid grid).
 *
 * Semua kartu dirender dalam SATU sheet flex-wrap. Kartu berukuran fisik tetap
 * (lebar dasar × scale) dan `break-inside: avoid` menjaga tiap kartu utuh; browser
 * memecah halaman secara alami saat jumlah kartu melebihi tinggi kertas.
 */
export function buildPrintDocument(
  templateHtml: string,
  cards: VoucherPrintCard[],
  layout: VoucherPrintLayout,
  brand: VoucherPrintBrand,
  printedAt: string,
): string {
  const cardHtml = sanitizeTemplateHtml(templateHtml);
  const metrics = printMetrics(cards.length, layout);
  const { paper, cardWidthMm, scale, gapMm } = metrics;

  const renderCard = (card: VoucherPrintCard) =>
    `<div class="v-card" data-price="${card.price_value}" data-tier="${card.price_tier}" ` +
    `style="--tier-color:${tierColor(card.price_value)}">${fillCard(cardHtml, card, brand, printedAt)}</div>`;

  const sheets = `<div class="sheet">${cards.map(renderCard).join('\n')}</div>`;

  const pageSize = paper.heightMm === null ? `${paper.widthMm}mm auto` : `${paper.widthMm}mm ${paper.heightMm}mm`;
  const cutRule = layout.cutLines ? '.v-card{outline:1px dashed #94a3b8;outline-offset:-1px}' : '';

  // `zoom` menskalakan seluruh kartu proporsional (termasuk font) dan ikut
  // memengaruhi layout di Chromium, sehingga flex-wrap menghitung ulang jumlah
  // kartu per baris — tidak ada tumpang tindih atau kartu terpotong.
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Voucher</title>
<style>
@page{size:${pageSize};margin:${layout.marginMm}mm}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#0f172a}
.sheet{display:flex;flex-wrap:wrap;gap:${gapMm}mm}
.v-card{width:${cardWidthMm}mm;flex:0 0 ${cardWidthMm}mm;max-width:${cardWidthMm}mm;zoom:${scale};break-inside:avoid;page-break-inside:avoid;min-width:0}
${cutRule}
@media screen{body{padding:8px;background:#e2e8f0}.sheet{background:#fff;padding:${layout.marginMm}mm;margin-bottom:12px}}
</style></head>
<body>
${sheets}
</body></html>`;
}

/**
 * Cetak dokumen lewat jendela cetak khusus.
 *
 * Chrome mengabaikan `print()` dari iframe yang lintas-origin (sandbox tanpa
 * allow-same-origin), sehingga dialog cetak tidak pernah muncul. Karena itu
 * dokumen ditulis ke jendela baru yang same-origin — dipanggil langsung dari
 * klik pengguna agar tidak kena popup blocker. Bila jendela diblokir, dipakai
 * iframe same-origin (script tetap mati karena sandbox tanpa allow-scripts).
 */
export function printHtmlDocument(html: string): void {
  const existing = document.getElementById('voucher-print-frame');
  existing?.remove();

  const win = window.open('', '_blank', 'width=1024,height=768');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();

    let printed = false;
    const runPrint = () => {
      if (printed) return;
      printed = true;
      win.focus();
      win.print();
    };
    if (win.document.readyState === 'complete') {
      window.setTimeout(runPrint, 150);
    } else {
      win.addEventListener('load', () => window.setTimeout(runPrint, 150), { once: true });
      // Jaring pengaman bila event load tidak pernah datang.
      window.setTimeout(runPrint, 1000);
    }
    return;
  }

  const frame = document.createElement('iframe');
  frame.id = 'voucher-print-frame';
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  // allow-same-origin: syarat Chrome mau menjalankan print() dari iframe.
  // Tanpa allow-scripts: dokumen cetak tetap tidak bisa menjalankan script.
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
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

  if (template.layout.marginMm < 5 || template.layout.marginMm > 24) out.push('Margin halaman harus 5-24 mm.');
  if (template.layout.gapMm < 0 || template.layout.gapMm > 15) out.push('Jarak antar kartu harus 0-15 mm.');
  const cardWidth = Number(template.layout.cardWidthMm ?? 0);
  if (cardWidth && (cardWidth < 15 || cardWidth > 300)) out.push('Lebar kartu harus 15-300 mm.');
  const scale = Number(template.layout.scale ?? 1);
  if (scale < 0.5 || scale > 2) out.push('Skala kartu harus 0.5-2.');
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
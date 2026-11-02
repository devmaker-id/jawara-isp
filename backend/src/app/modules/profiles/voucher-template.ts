/**
 * Template kartu voucher.
 *
 * Disimpan sebagai JSON pada config `voucher_templates` (bukan tabel baru):
 * isinya konfigurasi tampilan, bukan data transaksi. Teks boleh memakai
 * variabel `{{nama}}` yang diganti saat PDF dibuat — daftar variabel yang sah
 * ada di TEMPLATE_VARIABLES dan dipakai juga oleh halaman Pengaturan.
 *
 * KEAMANAN: nilai ini datang dari form admin, jadi diperlakukan sebagai input
 * tidak tepercaya sebelum disimpan:
 *   - hanya properti yang dikenal yang dipakai (objek dibangun ulang),
 *   - karakter kendali dibuang, tag HTML (`<` / `>`) DITOLAK,
 *   - variabel harus ada di daftar putih,
 *   - panjang teks, jumlah baris, dan jumlah template dibatasi.
 * Tujuannya bukan sekadar rapi: template ikut masuk ke mesin PDF dan ke halaman
 * lain, jadi tidak boleh ada markup/script yang bisa lolos ke sana.
 *
 * ponytail: teks saja (tanpa gambar/QR/warna per template). Layout hanya
 * kolom/margin/gap, dipetakan ke geometri PDF.
 */

export interface VoucherTemplateLayout {
  /** Kolom kartu per halaman: 1-3 (tinggi kartu tetap). */
  columns: 1 | 2 | 3;
  /** Margin halaman dalam milimeter: 5-24. */
  marginMm: number;
  /** Jarak antar kartu dalam milimeter: 2-15. */
  gapMm: number;
}

export interface VoucherTemplate {
  id: string;
  name: string;
  /** Baris paling atas, kecil & redup. */
  header: string;
  /** Baris judul di bawah header. */
  title: string;
  /** Baris isi (maks 3, mengikuti tinggi kartu). */
  lines: string[];
  /** Baris paling bawah, kecil & redup. */
  footer: string;
  /** Hanya template aktif yang ditawarkan saat mencetak voucher. */
  enabled: boolean;
  layout: VoucherTemplateLayout;
}

export const MAX_TEMPLATES = 20;
export const MAX_TEMPLATE_LINES = 3;
const MAX_NAME = 40;
const MAX_TEXT = 60;

export const DEFAULT_LAYOUT: VoucherTemplateLayout = { columns: 3, marginMm: 8.5, gapMm: 3.5 };

/** Variabel yang bisa dipakai di header/title/lines/footer. */
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

export const DEFAULT_TEMPLATES: VoucherTemplate[] = [
  {
    id: 'klasik',
    name: 'Klasik',
    header: '{{brand}}',
    title: 'Voucher {{profile}}',
    lines: ['Harga {{price}}', 'Pemilik {{owner}}'],
    footer: 'Masa aktif mulai login pertama',
    enabled: true,
    layout: DEFAULT_LAYOUT,
  },
  {
    id: 'ringkas',
    name: 'Ringkas',
    header: '{{brand}} · {{profile_type}}',
    title: '{{profile}} · {{price}}',
    lines: [],
    footer: '{{printed_at}}',
    enabled: true,
    layout: DEFAULT_LAYOUT,
  },
  {
    id: 'reseller',
    name: 'Reseller',
    header: '{{brand}}',
    title: '{{profile}}',
    lines: ['Harga {{price}}', 'Reseller {{owner}}', 'Pelanggan {{customer}}'],
    footer: '{{printed_at}}',
    enabled: true,
    layout: DEFAULT_LAYOUT,
  },
];

/** Kesalahan validasi template; dipetakan jadi HTTP 400 oleh pemanggil. */
export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

// Karakter kendali (termasuk newline/tab) tidak pernah dipakai di PDF dan bisa
// merusak stream; dibuang di satu tempat.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Teks satu baris: buang karakter kendali, tolak markup HTML.
 * `<` dan `>` ditolak (bukan dibersihkan) supaya admin tahu inputnya tidak
 * dipakai — bukan diam-diam berubah.
 */
function cleanText(value: unknown, field: string, max = MAX_TEXT): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TemplateValidationError(`${field} harus berupa teks.`);
  const text = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (/[<>]/.test(text)) {
    throw new TemplateValidationError(`${field} tidak boleh memuat karakter < atau >.`);
  }
  if (text.length > max) {
    throw new TemplateValidationError(`${field} maksimal ${max} karakter.`);
  }
  return text;
}

/** Hanya token yang ada di daftar putih; token lain = template ditolak. */
function assertKnownVariables(text: string, field: string): void {
  const tokens = text.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? [];
  for (const token of tokens) {
    const name = token.slice(2, -2).trim().toLowerCase();
    if (!VARIABLE_NAMES.has(name)) {
      throw new TemplateValidationError(
        `${field} memakai variabel tidak dikenal: ${token}. Gunakan daftar variabel di editor.`,
      );
    }
  }
  // Kurung kurawal yang tidak berpasangan hampir pasti salah ketik dan akan
  // tercetak apa adanya — lebih baik ditolak.
  if (/\{\{|\}\}/.test(text.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, ''))) {
    throw new TemplateValidationError(`${field} memakai {{...}} yang tidak lengkap.`);
  }
}

function cleanLayout(value: unknown): VoucherTemplateLayout {
  const row = (value ?? {}) as Record<string, unknown>;
  const columns = Number(row.columns ?? DEFAULT_LAYOUT.columns);
  const marginMm = Number(row.marginMm ?? DEFAULT_LAYOUT.marginMm);
  const gapMm = Number(row.gapMm ?? DEFAULT_LAYOUT.gapMm);

  if (![1, 2, 3].includes(columns)) {
    throw new TemplateValidationError('layout.columns harus 1, 2, atau 3.');
  }
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

/**
 * Validasi ketat untuk PENYIMPANAN. Melempar TemplateValidationError bila ada
 * yang tidak memenuhi aturan; tidak pernah menyimpan nilai yang dibersihkan
 * diam-diam.
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
  if (!Array.isArray(parsed)) {
    throw new TemplateValidationError('voucher_templates harus berupa array.');
  }
  if (parsed.length === 0) {
    throw new TemplateValidationError('Minimal satu template voucher harus ada.');
  }
  if (parsed.length > MAX_TEMPLATES) {
    throw new TemplateValidationError(`Maksimal ${MAX_TEMPLATES} template voucher.`);
  }

  const used = new Set<string>();
  const templates: VoucherTemplate[] = [];

  parsed.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TemplateValidationError(`Template ke-${index + 1} bukan objek.`);
    }
    const row = item as Record<string, unknown>;
    const name = cleanText(row.name, `Template ke-${index + 1}: nama`, MAX_NAME);
    if (!name) throw new TemplateValidationError(`Template ke-${index + 1}: nama wajib diisi.`);

    let id = slug(name);
    let suffix = 2;
    while (used.has(id)) id = `${slug(name)}-${suffix++}`;
    used.add(id);

    const header = cleanText(row.header, `${name}: header`);
    const title = cleanText(row.title, `${name}: judul`);
    const footer = cleanText(row.footer, `${name}: footer`);
    assertKnownVariables(header, `${name}: header`);
    assertKnownVariables(title, `${name}: judul`);
    assertKnownVariables(footer, `${name}: footer`);

    if (row.lines !== undefined && !Array.isArray(row.lines)) {
      throw new TemplateValidationError(`${name}: lines harus berupa array.`);
    }
    const rawLines = Array.isArray(row.lines) ? row.lines : [];
    if (rawLines.length > MAX_TEMPLATE_LINES) {
      throw new TemplateValidationError(`${name}: baris isi maksimal ${MAX_TEMPLATE_LINES}.`);
    }
    const lines = rawLines.map((line, i) => {
      const text = cleanText(line, `${name}: baris ${i + 1}`);
      assertKnownVariables(text, `${name}: baris ${i + 1}`);
      return text;
    });
    if (lines.some((line) => line === '')) {
      throw new TemplateValidationError(`${name}: baris isi tidak boleh kosong.`);
    }
    if (!header && !title && lines.length === 0 && !footer) {
      throw new TemplateValidationError(`${name}: template tidak boleh kosong semua.`);
    }

    templates.push({
      id,
      name,
      header,
      title,
      lines,
      footer,
      enabled: row.enabled === undefined ? true : row.enabled === true,
      layout: cleanLayout(row.layout),
    });
  });

  return templates;
}

/**
 * JSON dari config → daftar template untuk DIBACA/dicetak. Nilai rusak tidak
 * menggagalkan pencetakan: dipakai template bawaan. Nilai yang tidak lolos
 * validasi ketat dibersihkan semampunya, bukan dipercaya apa adanya.
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

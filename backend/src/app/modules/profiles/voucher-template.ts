/**
 * Template kartu voucher.
 *
 * Disimpan sebagai JSON pada config `voucher_templates` (bukan tabel baru):
 * isinya konfigurasi tampilan, bukan data transaksi. Teks boleh memakai
 * variabel `{{nama}}` yang diganti saat PDF dibuat — daftar variabel yang sah
 * ada di TEMPLATE_VARIABLES dan dipakai juga oleh halaman Pengaturan.
 *
 * ponytail: teks saja (tanpa gambar/QR/warna per template). Tambah properti baru
 * di sini + di voucher-pdf bila suatu saat perlu.
 */

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
}

export const MAX_TEMPLATES = 12;
export const MAX_TEMPLATE_LINES = 3;
const MAX_TEXT = 60;

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

export const DEFAULT_TEMPLATES: VoucherTemplate[] = [
  {
    id: 'klasik',
    name: 'Klasik',
    header: '{{brand}}',
    title: 'Voucher {{profile}}',
    lines: ['Harga {{price}}', 'Pemilik {{owner}}'],
    footer: 'Masa aktif mulai login pertama',
  },
  {
    id: 'ringkas',
    name: 'Ringkas',
    header: '{{brand}} · {{profile_type}}',
    title: '{{profile}} · {{price}}',
    lines: [],
    footer: '{{printed_at}}',
  },
  {
    id: 'reseller',
    name: 'Reseller',
    header: '{{brand}}',
    title: '{{profile}}',
    lines: ['Harga {{price}}', 'Reseller {{owner}}', 'Pelanggan {{customer}}'],
    footer: '{{printed_at}}',
  },
];

const clean = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT) : fallback;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'template';

/**
 * JSON dari config → daftar template yang sah. Nilai rusak/kosong tidak
 * menggagalkan pencetakan: dipakai template bawaan.
 */
export function parseTemplates(raw: string | undefined | null): VoucherTemplate[] {
  if (!raw || raw.trim() === '') return DEFAULT_TEMPLATES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_TEMPLATES;
  }
  if (!Array.isArray(parsed)) return DEFAULT_TEMPLATES;

  const used = new Set<string>();
  const templates: VoucherTemplate[] = [];
  for (const item of parsed.slice(0, MAX_TEMPLATES)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = clean(row.name).trim();
    if (!name) continue;
    let id = clean(row.id).trim() || slug(name);
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    const lines = Array.isArray(row.lines)
      ? row.lines.map((line) => clean(line)).filter((line) => line.trim() !== '').slice(0, MAX_TEMPLATE_LINES)
      : [];
    templates.push({
      id,
      name,
      header: clean(row.header),
      title: clean(row.title),
      lines,
      footer: clean(row.footer),
    });
  }
  return templates.length > 0 ? templates : DEFAULT_TEMPLATES;
}

/** Ganti `{{variabel}}` dengan nilainya; token tak dikenal dibiarkan apa adanya. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

/**
 * Pembuat PDF voucher tanpa pustaka tambahan.
 *
 * PDF 1.4 sederhana: satu halaman berisi grid kartu 3 kolom, font standar
 * Helvetica/Courier (base-14, tidak perlu di-embed). Cukup untuk voucher yang
 * dicetak atau dikirim lewat WhatsApp.
 *
 * Isi kartu datang sudah dalam bentuk teks jadi (variabel template sudah
 * diganti pemanggil), jadi berkas ini hanya mengurus tata letak.
 *
 * ponytail: hanya teks Latin-1 dan tanpa gambar/QR. Naikkan ke pdfkit bila
 * suatu saat butuh QR code atau font khusus.
 */

export interface VoucherCard {
  /** Baris paling atas, kecil & redup. */
  header: string;
  /** Baris judul. */
  title: string;
  username: string;
  /** Kosong = tidak dicetak (mis. password sama dengan username). */
  password: string;
  /** Maks 3 baris isi. */
  lines: string[];
  /** Baris kaki kartu. */
  footer: string;
}

const A4 = { w: 595.28, h: 841.89 };
const CARD_H = 100;
const MM_TO_PT = 2.834645669;

/** Tata letak halaman dari template (kolom, margin, jarak). */
export interface PdfLayout {
  columns?: number;
  marginMm?: number;
  gapMm?: number;
}

interface Geometry {
  cols: number;
  margin: number;
  gap: number;
  cardW: number;
  perPage: number;
}

// Nilai bawaan = 3 kolom, margin 8,5 mm, jarak 3,5 mm (setara perilaku lama).
function geometry(layout?: PdfLayout): Geometry {
  const cols = Math.min(3, Math.max(1, Math.round(layout?.columns ?? 3)));
  const margin = Math.max(0, (layout?.marginMm ?? 8.5) * MM_TO_PT);
  const gap = Math.max(0, (layout?.gapMm ?? 3.5) * MM_TO_PT);
  const cardW = (A4.w - margin * 2 - gap * (cols - 1)) / cols;
  const rows = Math.max(1, Math.floor((A4.h - margin * 2 + gap) / (CARD_H + gap)));
  return { cols, margin, gap, cardW, perPage: cols * rows };
}

/** Karakter di luar Latin-1 akan merusak stream, jadi diganti. */
function latin(text: string): string {
  return String(text ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    // WinAnsiEncoding mencakup Latin-1 (0xA0-0xFF), jadi hanya karakter di
    // luar itu yang diganti agar stream tetap sah.
    .replace(/[^\x20-\xff]/g, '?');
}

function escape(text: string): string {
  return latin(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Satu baris teks pada posisi absolut. */
function text(x: number, y: number, size: number, font: string, gray: number, value: string): string {
  return (
    `BT /${font} ${size} Tf ${gray} g 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ` +
    `(${escape(value)}) Tj ET\n`
  );
}

function pageContent(cards: VoucherCard[], geom: Geometry): string {
  let out = '';
  cards.forEach((card, index) => {
    const col = index % geom.cols;
    const row = Math.floor(index / geom.cols);
    const x = geom.margin + col * (geom.cardW + geom.gap);
    const top = A4.h - geom.margin - row * (CARD_H + geom.gap);

    // Kotak putus-putus sebagai garis potong.
    out +=
      `0.6 w [3 2] 0 d 0.55 G ${x.toFixed(2)} ${(top - CARD_H).toFixed(2)} ` +
      `${geom.cardW.toFixed(2)} ${CARD_H.toFixed(2)} re S [] 0 d\n`;

    if (card.header) out += text(x + 8, top - 13, 7, 'F1', 0.45, card.header);
    if (card.title) out += text(x + 8, top - 26, 8, 'F1', 0.2, card.title);
    out += text(x + 8, top - 46, 15, 'F2', 0, card.username);
    if (card.password) out += text(x + 8, top - 60, 10, 'F3', 0, card.password);
    // `lines` opsional saat runtime: kartu tanpa isi tambahan tetap harus bisa
    // dicetak, bukan menggagalkan seluruh PDF.
    (card.lines ?? []).slice(0, 3).forEach((line, i) => {
      out += text(x + 8, top - 73 - i * 8.5, 6.5, 'F1', 0.35, line);
    });
    if (card.footer) out += text(x + 8, top - 95, 6, 'F1', 0.5, card.footer);
  });
  return out;
}

export function buildVoucherPdf(
  cards: VoucherCard[],
  title = 'Voucher',
  footer?: string,
  layout?: PdfLayout,
): Buffer {
  const geom = geometry(layout);
  const pages: string[] = [];
  if (cards.length === 0) {
    pages.push(
      text(geom.margin, A4.h - geom.margin - 16, 12, 'F1', 0.3, 'Tidak ada voucher pada pilihan ini.'),
    );
  } else {
    for (let start = 0; start < cards.length; start += geom.perPage) {
      pages.push(pageContent(cards.slice(start, start + geom.perPage), geom));
    }
  }
  // Baris kaki halaman: tanggal cetak + jumlah voucher, supaya lembar cetak bisa
  // dilacak kapan dan dari kriteria mana ia dibuat.
  if (footer)
    for (let i = 0; i < pages.length; i += 1) pages[i] += text(geom.margin, 14, 7, 'F1', 0.45, footer);

  // Objek: 1 catalog, 2 pages, 3-5 font, lalu pasangan (page, content).
  const firstPageId = 6;
  const kids = pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
  ];

  pages.forEach((content, i) => {
    const pageId = firstPageId + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w.toFixed(2)} ${A4.h.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${escape(title)}) ` +
    `/Producer (jawara-isp) >> >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

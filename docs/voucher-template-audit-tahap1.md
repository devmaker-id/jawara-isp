# Audit Tahap 1 — Template & Cetak Voucher (read-only)

Tanggal: 2026-11-05. Sifat: read-only, belum ada perubahan kode.

Konteks penting sebelum detail: konsep di `~/voucher-template-konsep.md` mengacu
`~/voucher-panjang.tpl` sebagai "template pakai sekarang", dan mengusulkan mesin
Twig/Smarty. Tetapi kode repo TIDAK lagi memakai Smarty/twig. Ia sudah di-migrasi
ke sistem token `{{var}}` dengan render di browser (iframe sandbox). Jadi konsep
bukan tambahan kecil — ia mengganti arsitektur render yang sudah ada.

## 1. Arsitektur saat ini

- Simpan template: SATU nilai JSON array di tabel `config`, key `voucher_templates`
  (kolom MEDIUMTEXT, migrasi 034). BUKAN tabel khusus.
- Render HTML: di BROWSER (iframe sandbox, `src/utils/voucher-print.ts`). Server
  TIDAK pernah render HTML; ia hanya simpan + validasi.
- Mesin PDF server terpisah: `voucher-pdf.ts` + `FALLBACK_TEXT_TEMPLATE` (teks
  polos), dipakai untuk ekspor PDF + WhatsApp. Template HTML tidak dipakai di sisi
  server.

## 2. Titik pemasangan (mounting points)

Backend (`backend/src/app/modules/`):
- profiles/voucher-template.ts — mesin validasi + daftar variabel + template bawaan.
  * `VoucherTemplate` { id, name, html, enabled, layout }, `locked` dihitung dari NAMA.
  * `TEMPLATE_VARIABLES` (16 token).
  * `DEFAULT_TEMPLATES` (6): default, panjang, ai-generation, klasik, ringkas, reseller.
  * `LOCKED_TEMPLATE_NAMES` = ['Default','Klasik','Voucher panjang','Ai Generation'].
  * `validateTemplates()` / `parseTemplates()` / `fillTemplate()`.
- profiles/profiles.controller.ts — `VouchersController`:
  * GET /vouchers/templates (katalog template + variabel + brand),
    /vouchers, /vouchers/export.csv|.pdf, /generate, /:id/activate,
    /bulk/status, /send-whatsapp, /remove, /expire-overdue.
  * CRUD template TIDAK di sini — lewat settings.
- settings/settings.service.ts — `update()` memanggil `validateTemplates()` lalu
  simpan JSON ke config. Endpoint: `PUT /api/settings` body `values.voucher_templates`.
- settings/settings.keys.ts — key `voucher_templates` (default ''), group 'voucher';
  key branding: brand_name, brand_tagline, brand_primary_color, brand_logo_url,
  brand_footer_text.
- profiles/voucher-code.ts — pembuat kode acak (charset, panjang). profiles/voucher-pdf.ts
  — PDF teks server.
- whatsapp-gateway/wa-gateway.service.ts — memakai package `qrcode` (QR login WA).
  Artinya dependency `qrcode@1.5.4` SUDAH terpasang, tapi belum dipakai untuk QR voucher.

Frontend (`frontend/src/`):
- pages/voucher/VoucherManagement.tsx — daftar voucher + generate + dialog cetak +
  penjualan + kirim WA.
- pages/Settings.tsx (tab=voucher) → render `VoucherTemplatesPanel`.
- components/voucher/VoucherTemplatesPanel.tsx — tabel template + editor CodeMirror +
  pratinjau iframe. Aksi: edit, duplikat, jadikan default, toggle aktif, hapus (locked diblok).
- components/voucher/VoucherPrintPreview.tsx — preview + window.print().
- components/voucher/CodeEditor.tsx — editor CodeMirror.
- utils/voucher-print.ts — renderer klien: sanitize (DOMParser allowlist), fillCard,
  buildPrintDocument (grid + @page + data-price/data-tier/--tier-color), printHtmlDocument,
  cardFromRow, tierColor/tierLabel.
- config/menu.ts baris 155 — link menu "Template Voucher" → `/settings?tab=voucher`.

Migrasi (`backend/migrations/`): 49 file. Relevan: 034 (config MEDIUMTEXT),
026 (voucher_sales), 007 (voucher_user_type), 015 (voucher_customer_constraint),
024/025 (permissions). TIDAK ada tabel `voucher_template`.

## 3. Variabel sekarang vs konsep

Sekarang (16): brand, tagline, profile, profile_type, user_type, username, password,
price, price_value, price_tier, credential, owner, created_by, customer, status,
expires, created_at, printed_at.

Konsep minta (per voucher): code, secret, price/total, timelimit, valid_period, plan,
type, bandwidth, number, owner_name, created_date, qr (PNG server-side).
Per perusahaan: company, phone, hotspot_url, logo, seller/owner, batch, currency_code,
dec_point, thousands_sep.
Filter: upper, truncate. Blok kondisi: show_logo, show_profile, validity_in_days,
show_company_info.

→ Nama variabel berbeda total (username/password vs code/secret), dan tidak ada
timelimit/valid_period/plan/bandwidth/number/qr/company/phone/hotspot_url/logo/
seller/batch/currency/dec_point/thousands_sep/filter/if.

## 4. Kesenjangan konsep vs kode (hasil audit)

1. Keputusan #1 "kolom Bisa Diakses Oleh dihapus" — sudah tidak ada (tidak pernah ada).
   Tidak ada kerja.
2. Keputusan #2 template sistem terkunci (no edit/rename/delete, hanya disable) +
   admin bisa kunci manual. — SEBAGIAN. Kunci sekarang berdasarkan NAMA (whitelist),
   hapus/rename diblokir server & klien, TAPI `html` locked masih bisa DIEDIT (openEdit
   tidak cek locked), dan TIDAK ada toggle kunci manual is_locked/is_system.
3. Keputusan #3 editor full HTML + guardrail marker `<!-- START/END CUSTOM HTML -->`.
   — BELUM. Validasi sekarang regex-denylist (tolak tag aktif), bukan model marker
   dengan kerangka luar dibangun ulang server-side.
4. Daftar template: dropdown hijau "TEMPLATE VOUCHER" (Buat/Hapus yang dipilih),
   checkbox massal, "Show N entries" + Search. — BELUM. Sekarang tombol "Buat template
   baru", tanpa bulk delete, tanpa search, tanpa show-N.
   Aksi "lihat(preview)/edit/hapus/duplikat + toggle" — sekarang ada edit/duplikat/
   hapus/toggle/default, tapi preview hanya di dalam editor (bukan dari list), tanpa
   checkbox massal.
5. Mesin render twig.js backend (if/else, set map harga→warna, number_format, filter,
   loop). — BELUM SAMA SEKALI. Sekarang token {{var}} + regex di browser, tanpa
   if/foreach/number_format/filter. Ini gap terbesar.
6. QR server-side (`{{qr}}` data-URI PNG via qrcode) — BELUM untuk voucher. Package
   `qrcode` sudah ada (dipakai WA login), tapi tidak ada variabel qr/voucher dan tag
   `<img>` justru DITOLAK (DENIED_TAGS). Perlu path QR terpisah.
7. Master header/footer + halaman "Pengaturan Header & Footer Cetak" — BELUM. CSS
   halaman dibangun hardcoded di buildPrintDocument (@page margin 7/3/9/3mm diganti
   marginMm dari layout), tidak ada file/endpoint header/footer terpisah.
8. Alur cetak: "Menu Cetak Voucher (tanpa centang)" — SEBAGIAN. openPrint() mensyaratkan
   centang (hasSelection). Dialognya sudah dukung filter (status/profil/pemilik/tanggal),
   tapi tak bisa dibuka tanpa centang.
9. DB: tabel khusus `voucher_template` (id, name, body_html, is_locked, is_system,
   status, created_at, updated_at) + settings header/footer + company. — BELUM. Semua
   JSON di config. `status` = boolean `enabled`, tidak ada is_system/body-vs-frame.
   Penolakan delete locked server-side SUDAH ada (validateTemplates menuntut nama
   locked tetap ada), tapi bukan validasi per-id seperti yang konsep minta.
10. Migrasi port 4 template Smarty lama (Master, JMNET, BIBITNET, 4_POS_58 QRCode).
    — TIDAK RELEVAN. Repo tidak punya template Smarty; `~/voucher-panjang.tpl` adalah
    artefak lama di luar repo. Template sekarang 6 buah inline di voucher-template.ts.

## 5. Keputusan print-flow (klarifikasi user, 2026-11-05)

User suka sandbox live preview → PERTAHANKAN. Yang tidak disukai: layout sekarang
menetapkan ukuran (grid kolom×baris) yang memaksa kartu melar/menyusut dan berpotensi
terpotong saat kertas/margin diubah.

Target alur cetak yang diinginkan:
1. Filter voucher (mis. menurut owner) → "cetak" → SEMUA voucher hasil filter langsung
   masuk live preview → klik print. TANPA wajib centang satu-per-satu.
2. Saat custom kertas / scale / margin, kartu MENYESUAIKAN diri (wrap), tidak tumpang
   tindih, dan format kartu tidak terpotong.

Klarifikasi "scale" (user menjawab opsi b): SCALE itu kontrol yang memperbesar/mengecil
ukuran kartu DAN ikut TERCETAK — kartu punya ukuran dasar (mm) yang bisa di-scale
(persen/faktor) sebelum sheet me-wrap-nya. Jadi dialog cetak punya: kertas (jenis +
orientasi + ukuran custom), margin (mm), GAP (mm), dan SCALE kartu — tanpa kolom×baris
yang dipatok. Perubahan scale mempengaruhi hasil cetak, bukan hanya zoom layar.

Akar teknis gap: `utils/voucher-print.ts` buildPrintDocument memakai
`grid-template-columns:repeat(cols,1fr)` + `grid-auto-rows:<mm>`, sehingga ukuran kartu
dipaksa mengikuti grid. Yang diinginkan = pola lama `table.voucher{display:inline-block}`
(fluid grid): kartu berukuran fisik TETAP (mm), sheet menjadi container yang membungkus
(flex-wrap / grid `repeat(auto-fill,minmax(Xmm,1fr))`); kertas + margin hanya menentukan
berapa kartu per baris, kartu tidak pernah berubah skala atau terpotong.

Implikasi untuk tahap 2: fokus render print-flow ke "kartu ukuran tetap + wrap alami",
bukan grid kolom×baris yang dipatok.

## 6. Catatan keputusan arsitektur (untuk tahap 2)

Sistem sekarang sudah matang (render sandbox, sanitasi ganda, grid/thermal/cut-line,
6 template, warna per nominal via data-tier/--tier-color). Konsep menggantinya dengan
render backend Twig + QR server + variabel level perusahaan + tabel DB khusus +
header/footer. Sebelum eksekusi, perlu keputusan apakah:
(a) inkremental di atas sistem {{var}} sekarang (tambah variabel qr/logo/company +
    filter + kunci manual + header/footer), atau
(b) migrasi penuh ke twig.js server-side seperti konsep (biaya besar, ganti semua
    template + tambah tabel + pindah render ke server).
# Review Migrasi 001 / 002 / 003 — Jawara ISP

Status: dokumen review. **Tidak ada migrasi yang dijalankan di produksi.**
Semua uji eksekusi hanya dilakukan pada instance MariaDB sekali-pakai
(`isp_reseller_it`, port 3399, datadir di direktori scratch) yang sudah dihapus
setelah pengujian.

## Ringkasan urutan yang direkomendasikan

| Urutan | File | Alasan urutan |
|---|---|---|
| 1 | `001_payments.sql` | Ledger pembayaran + enum `partial`. Dibutuhkan sebelum isolasi pembayaran/laporan bisa diuji. |
| 2 | `002_audit_logs_soft_actor.sql` | Membuat jejak audit bertahan saat akun dihapus (`user_id` nullable + `ON DELETE SET NULL`). Dibutuhkan sebelum penugasan pemilik diaudit permanen. |
| 3 | `003_customer_reseller_ownership.sql` | Membuka kolom kepemilikan. Dijalankan setelah 001/002 dan setelah kode scoping siap. |

Catatan: 003 secara teknis tidak bergantung pada 001, tetapi menjalankannya lebih
dulu tidak berguna karena laporan/pembayaran masih 503, dan endpoint kepemilikan
akan aktif tanpa data pendukung.

## 001_payments.sql

- **Sifat DDL**: `ALTER TABLE invoices MODIFY status ENUM(...)` adalah DDL dan
  **auto-commit**. Ia terjadi sebelum `START TRANSACTION`, sehingga bila gerbang
  `_mig001_gate` gagal, backfill ter-rollback tetapi **pelebaran enum `partial`
  tetap tertinggal**. Efeknya aditif/aman, namun laporan "migrasi dibatalkan"
  harus dibaca sebagai "data tidak diubah", bukan "skema tidak berubah".
- **Gerbang fail-closed**: `_mig001_gate` dibuat sebelum transaksi (CREATE
  PROCEDURE memicu implicit commit). Terbukti: gate gagal → exit code ≠ 0 dan
  tidak ada baris backfill yang masuk.
- **Idempotensi**: `CREATE TABLE IF NOT EXISTS` + `NOT EXISTS` pada backfill
  membuat pengulangan tidak menggandakan baris.
- **Rollback**: `partial` → `unpaid` (paid_date dikosongkan), lalu enum
  dipersempit, lalu `DROP TABLE payments`. **Ledger hilang** bila ekspor langkah 0
  dilewati; tidak bisa dipulihkan tanpa backup.
- **Validasi sesudah**: invoice paid+paid_date == jumlah invoice dengan pembayaran
  sah; total nominal sama; tidak ada overpay; tidak ada void setengah jadi.

## 002_audit_logs_soft_actor.sql

- Tiga pernyataan terpisah (DROP FK → MODIFY → ADD FK), **tanpa gerbang**. Bila
  `ADD CONSTRAINT` gagal, kolom tertinggal nullable tanpa FK.
- **Validasi wajib sesudah**: `DELETE_RULE = 'SET NULL'` dan `IS_NULLABLE = 'YES'`.
- **Rollback tidak boleh langsung** `MODIFY ... NOT NULL`: MariaDB menolak
  (ERROR 1830) bila sudah ada baris `user_id IS NULL`. Urutan benar: arsipkan ke
  `audit_logs_orphan` → hapus dari tabel utama → lepas FK → kencangkan kolom →
  pasang kembali FK CASCADE. Data audit yang dihapus **tidak dapat dipulihkan**
  tanpa dump.

## 003_customer_reseller_ownership.sql

- Satu pernyataan `ALTER TABLE` menambah kolom + indeks + FK sekaligus. MariaDB
  **tidak** menjalankan ALTER secara atomik; kegagalan di tengah dapat
  meninggalkan skema parsial (kolom ada, FK belum).
- Gerbang `_mig003_gate('pre')` menolak:
  - kolom sudah ada sebagian/lengkap (partial state / sudah diterapkan),
  - indeks/FK ada tanpa kolom.
- Gerbang `_mig003_gate('post')` memverifikasi: kolom `int(11)` NULLABLE, indeks
  `idx_customers_reseller`, FK `fk_customers_reseller`, `ON DELETE SET NULL`.
- Bila gerbang menolak, prosedur `_mig003_gate` tertinggal; percobaan berikutnya
  menghapusnya lewat `DROP PROCEDURE IF EXISTS` di baris pertama.
- **Tidak ada alokasi otomatis**: semua pelanggan lama menjadi `reseller_id = NULL`.
- **FK `ON DELETE SET NULL`**: hapus akun reseller melepas pelanggan, tidak
  menghapus pelanggan/tagihan. Pelepasan otomatis ini **tidak diaudit** (FK bekerja
  di level database); audit hanya tercatat untuk perubahan lewat endpoint admin.
- **Rollback**: `DROP FOREIGN KEY` → `DROP KEY` → `DROP COLUMN`. Seluruh penugasan
  hilang kecuali diekspor lebih dulu (`SELECT id, reseller_id FROM customers`).
  Baris audit `CUSTOMER_OWNER_ASSIGNED` tetap ada tetapi tidak bisa dipakai
  merekonstruksi otomatis tanpa parsing JSON `details`.
- **Validasi sesudah**: `COUNT(*) = SUM(reseller_id IS NULL)` pada data lama;
  `EXPLAIN SELECT ... WHERE reseller_id = ?` memakai `idx_customers_reseller`;
  tidak ada `reseller_id` yang merujuk user hilang; tidak ada pelanggan ganda.

## Risiko umum yang belum hilang

1. **DDL non-atomik** pada ketiga file: rollback harus diverifikasi lewat
   `information_schema`, bukan diasumsikan berhasil.
2. **Rollback tidak memulihkan data** (ledger pembayaran, penugasan pemilik,
   baris audit yatim) — hanya backup/dump yang bisa.
3. **Metadata lock** saat ALTER dapat memblokir tulis ke tabel terkait sesaat;
   jalankan pada jendela yang disepakati, bukan otomatis.
4. **001 gate** membandingkan `SUM(payments) <> invoices.amount` untuk invoice
   `paid`; invoice `paid` tanpa `paid_date` tidak masuk backfill dan tidak
   diperiksa gate — perlu keputusan bisnis bila ada data seperti itu.

## Bukti uji di instance sekali-pakai (bukan produksi)

- Urutan 001 → 002 → 003 dijalankan pada `isp_reseller_it` dengan struktur
  produksi (audit CASCADE, enum 3 nilai, tanpa `payments`): ketiganya exit 0.
- 003 dijalankan ulang: **ditolak** dengan `ERROR 1644 ... migrasi sudah diterapkan`
  (exit 1) — tidak ada DDL ganda.
- Tes integrasi isolasi reseller: 34 tes PASS pada database tersebut.
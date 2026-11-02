-- 032_invoice_period_void.sql
-- Periode tagihan, kunci anti-ganda per kewajiban layanan, dan pembatalan
-- (void) tanpa hapus. Additive: tidak mengubah nominal/status tagihan lama,
-- tidak menyentuh RADIUS/OLT/pelanggan/voucher.
--
-- Keputusan penting:
--   * `period_start`/`period_end` NULL untuk semua baris lama (tidak diisi
--     berdasarkan perkiraan) dan untuk tagihan non-layanan. Perilaku lama
--     tetap berjalan sampai operator mengisi periodenya.
--   * Identitas kewajiban tagihan = (customer_id, username, period_start).
--     Tabel `services` belum ada, jadi `username` (akun RADIUS) yang dipakai.
--     UNIQUE tidak dapat memakai `period_start` langsung karena baris void
--     harus bisa digantikan tagihan koreksi → `period_key` = period_start
--     kecuali statusnya 'void' (NULL ikut keluar dari indeks UNIQUE).
--   * `username` NULL memang TIDAK unik: MariaDB menganggap NULL berbeda satu
--     sama lain, sehingga dua tagihan non-layanan pada periode yang sama tetap
--     sah dan tidak saling memblokir.
--   * Status `void`: baris tidak dihapus, nomor invoice tidak dipakai ulang,
--     alasan & pelaku tersimpan.
--   * `finance_events` dibuat terpisah dari audit_logs karena audit_logs tidak
--     punya kolom before/after dan FK user-nya ON DELETE CASCADE (jejak bisa
--     hilang saat akun dihapus). finance_events sengaja tanpa FK ke users dan
--     tanpa endpoint ubah/hapus: append-only.

-- =====================================================================
-- UP
-- =====================================================================
ALTER TABLE invoices
  MODIFY status ENUM('unpaid', 'paid', 'overdue', 'partial', 'void') NOT NULL DEFAULT 'unpaid',
  ADD COLUMN period_start DATE NULL AFTER due_date,
  ADD COLUMN period_end DATE NULL AFTER period_start,
  ADD COLUMN period_key DATE AS (IF(status = 'void', NULL, period_start)) PERSISTENT,
  ADD COLUMN voided_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN voided_by INT NULL,
  ADD COLUMN void_reason VARCHAR(255) NULL,
  ADD UNIQUE KEY uq_invoices_period (customer_id, username, period_key),
  ADD CONSTRAINT fk_invoices_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS finance_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('invoice', 'payment') NOT NULL,
  entity_id INT NOT NULL,
  action VARCHAR(40) NOT NULL,
  before_json LONGTEXT NULL,
  after_json LONGTEXT NULL,
  reason VARCHAR(255) NULL,
  actor_id INT NULL,
  actor_name VARCHAR(100) NULL,
  ip_address VARCHAR(45) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_finance_events_entity (entity_type, entity_id, id),
  KEY idx_finance_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- BUKTI
-- =====================================================================
-- SHOW CREATE TABLE invoices;      -- period_start/period_end/period_key, ENUM(+void)
-- SHOW CREATE TABLE finance_events;
-- SELECT COUNT(*) FROM invoices WHERE period_start IS NOT NULL;  -- 0 setelah migrasi
-- Uji anti-ganda (harus ERROR 1062 pada uq_invoices_period):
--   INSERT INTO invoices (invoice_number, customer_id, username, customer_name,
--                         amount, due_date, period_start, period_end)
--   VALUES ('INV-TEST-1', 1, 'uji', 'x', 1000, '2026-12-05', '2026-12-01', '2026-12-31');
--   INSERT ... ('INV-TEST-2', 1, 'uji', ... periode sama ...);
-- Uji penggantian setelah void (harus berhasil):
--   UPDATE invoices SET status = 'void' WHERE invoice_number = 'INV-TEST-1';
--   INSERT ... ('INV-TEST-3', 1, 'uji', ... periode sama ...);

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Lihat rollback/032_invoice_period_void_down.sql (idempoten). Tidak dijalankan
-- di produksi.
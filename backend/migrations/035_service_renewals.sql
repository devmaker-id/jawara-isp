-- 035_service_renewals.sql
-- Catatan perpanjangan layanan (Hotspot & PPPoE). Bukan pengganti invoice:
-- baris di sini adalah BUKTI TINDAKAN (siapa, kapan, periode apa, berapa,
-- invoice/pembayaran mana), sedangkan uangnya tetap di invoices + payments.
--
-- Alasan tabel terpisah:
--   * invoices tidak menyimpan aktor maupun masa aktif sebelum/sesudah,
--   * audit_logs berupa JSON tanpa kolom yang bisa di-query per pelanggan,
--   * riwayat perpanjangan perlu dibaca cepat per pelanggan/layanan.
--
-- Sifat: additive + idempoten. Tidak menyentuh tabel lain.

-- Penanda awal periode pemakaian: penegak RADIUS menjumlahkan pemakaian dari
-- radacct secara kumulatif. Tanpa penanda ini, pelanggan yang sudah menghabiskan
-- kuota/waktu di periode lama akan langsung diblokir lagi setelah diperpanjang.
ALTER TABLE radius_vouchers ADD COLUMN IF NOT EXISTS usage_reset_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS service_renewals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT NOT NULL,
  account_id INT NOT NULL,
  username VARCHAR(64) NOT NULL,
  profile_type ENUM('hotspot', 'ppp') NOT NULL,
  profile_id INT NOT NULL,
  profile_name VARCHAR(64) NOT NULL,
  prev_expires_at DATETIME NULL,
  period_start DATETIME NOT NULL,
  period_end DATETIME NULL,
  duration_seconds INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  invoice_id INT NULL,
  payment_id INT NULL,
  actor_id INT NULL,
  actor_name VARCHAR(100) NULL,
  note VARCHAR(255) NULL,
  -- Kunci dari dialog: satu kunci = satu perpanjangan. Klik ganda memakai
  -- kunci yang sama sehingga tidak menagih dua kali.
  idempotency_key VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_renewals_key (idempotency_key),
  KEY idx_renewals_customer (customer_id, created_at),
  KEY idx_renewals_account (account_id, created_at),
  CONSTRAINT fk_renewals_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- 028_customer_internet_no.sql
-- Nomor Internet: identitas PERMANEN pelanggan, dipakai untuk pencarian
-- (/inet 1312013), API, dan WhatsApp. Berbeda dari username RADIUS yang boleh
-- berganti saat pelanggan pindah paket, dan berbeda dari serial ONU yang boleh
-- berganti saat perangkat diganti.
--
-- KEPUTUSAN YANG DIKUNCI DI SINI
--   * Nomor disimpan di customers, bukan di radius_vouchers: satu pelanggan =
--     satu nomor, walaupun layanannya berubah (hotspot <-> ppp).
--   * VARCHAR, bukan angka: nomor bisa panjang dan tidak boleh kehilangan
--     digit nol di depan.
--   * UNIQUE tapi NULL: baris lama dan voucher (tanpa pelanggan) tetap sah.
--   * Nomor TIDAK dibuat di sini. Migrasi ini hanya menyediakan wadah +
--     penghitung; nomor hanya terbit bila operator mengisi `internet_no_start`
--     di tabel config. Dengan begitu tidak ada nomor yang dikarang otomatis.
--
-- Sifat: additive + idempoten. Tidak ada baris pelanggan yang diubah.

-- ---------------------------------------------------------------------------
-- 1. Kolom customers.internet_no
-- ---------------------------------------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE table_schema = DATABASE() AND table_name = 'customers'
                    AND column_name = 'internet_no');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE customers ADD COLUMN internet_no VARCHAR(20) NULL AFTER name',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. UNIQUE: satu nomor hanya untuk satu pelanggan.
--    NULL boleh berulang (MariaDB mengizinkan banyak NULL di index UNIQUE).
-- ---------------------------------------------------------------------------
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE table_schema = DATABASE() AND table_name = 'customers'
                    AND index_name = 'uq_customers_internet_no');
SET @sql := IF(@has_idx = 0,
  'ALTER TABLE customers ADD UNIQUE KEY uq_customers_internet_no (internet_no)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Bentuk nomor dijaga database: hanya digit, 4-20 karakter.
--    Aplikasi juga memvalidasi, tapi aturan ini tidak boleh bisa dilewati
--    lewat import atau SQL manual.
-- ---------------------------------------------------------------------------
SET @has_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                  WHERE table_schema = DATABASE() AND table_name = 'customers'
                    AND constraint_name = 'chk_customers_internet_no');
SET @sql := IF(@has_chk = 0,
  "ALTER TABLE customers ADD CONSTRAINT chk_customers_internet_no CHECK (internet_no IS NULL OR internet_no REGEXP '^[0-9]{4,20}$')",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 4. Penghitung nomor. AUTO_INCREMENT dipakai karena penomoran dijamin atomik
--    oleh database: dua permintaan bersamaan tidak mungkin mendapat nomor sama.
--    Nomor terbit = internet_no_start + (seq - 1); nilai awalnya diatur
--    operator lewat config `internet_no_start` (tidak diisi = tidak menerbitkan
--    nomor sama sekali).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS internet_no_sequence (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issued_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Gate: gagal terang-terangan kalau ada yang tidak terpasang.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig028_gate;

DELIMITER //
CREATE PROCEDURE _mig028_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_idx INT DEFAULT 0;
  DECLARE v_chk INT DEFAULT 0;
  DECLARE v_seq INT DEFAULT 0;
  DECLARE v_dup INT DEFAULT 0;

  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'internet_no';
  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '028: customers.internet_no belum ada';
  END IF;

  SELECT COUNT(*) INTO v_idx FROM information_schema.STATISTICS
   WHERE table_schema = DATABASE() AND table_name = 'customers'
     AND index_name = 'uq_customers_internet_no';
  IF v_idx = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '028: unique uq_customers_internet_no belum ada';
  END IF;

  SELECT COUNT(*) INTO v_chk FROM information_schema.TABLE_CONSTRAINTS
   WHERE table_schema = DATABASE() AND table_name = 'customers'
     AND constraint_name = 'chk_customers_internet_no';
  IF v_chk = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '028: check chk_customers_internet_no belum ada';
  END IF;

  SELECT COUNT(*) INTO v_seq FROM information_schema.TABLES
   WHERE table_schema = DATABASE() AND table_name = 'internet_no_sequence';
  IF v_seq = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '028: tabel internet_no_sequence belum ada';
  END IF;

  -- Tidak boleh ada nomor ganda (kalau ada, unique akan gagal dan itu wajar).
  SELECT COUNT(*) INTO v_dup FROM (
    SELECT internet_no FROM customers WHERE internet_no IS NOT NULL
     GROUP BY internet_no HAVING COUNT(*) > 1
  ) d;
  IF v_dup > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '028: ada nomor internet ganda di customers';
  END IF;
END//
DELIMITER ;

CALL _mig028_gate();
DROP PROCEDURE _mig028_gate;

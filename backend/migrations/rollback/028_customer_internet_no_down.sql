-- rollback/028_customer_internet_no_down.sql
-- Membatalkan migrasi 028. JALANKAN HANYA BILA DIMINTA.
--
-- PERINGATAN: nomor internet yang sudah terbit IKUT HILANG dan tidak bisa
-- dibuat ulang dengan nilai yang sama (penghitung dimulai dari awal lagi).
-- Karena itu urutan yang benar sebelum rollback:
--   1. ekspor dulu: SELECT id, name, internet_no FROM customers WHERE internet_no IS NOT NULL;
--   2. baru jalankan berkas ini.
-- Alternatif yang lebih aman: pulihkan dari dump di ~/backups/.
--
-- Sifat: idempoten (aman dijalankan dua kali).

SET @has_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                  WHERE table_schema = DATABASE() AND table_name = 'customers'
                    AND constraint_name = 'chk_customers_internet_no');
SET @sql := IF(@has_chk > 0,
  'ALTER TABLE customers DROP CHECK chk_customers_internet_no',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE table_schema = DATABASE() AND table_name = 'customers'
                    AND index_name = 'uq_customers_internet_no');
SET @sql := IF(@has_idx > 0,
  'ALTER TABLE customers DROP INDEX uq_customers_internet_no',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE table_schema = DATABASE() AND table_name = 'customers'
                    AND column_name = 'internet_no');
SET @sql := IF(@has_col > 0,
  'ALTER TABLE customers DROP COLUMN internet_no',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS internet_no_sequence;

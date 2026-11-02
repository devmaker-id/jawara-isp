-- rollback/032_invoice_period_void_down.sql
-- Membatalkan periode, kunci anti-ganda, void tagihan, dan finance_events.
-- AMAN: tidak menghapus baris tagihan/pembayaran. Tagihan berstatus 'void'
-- dikembalikan ke 'unpaid' karena status itu belum ada sebelum migrasi 032.
-- `finance_events` dibuang (append-only, hanya berisi jejak perubahan).
-- Sifat: idempoten (aman dijalankan dua kali).
--
-- URUTAN PENTING: indeks uq_invoices_period harus dilepas SEBELUM status void
-- diubah. Bila tidak, tagihan koreksi yang terbit menggantikan tagihan void
-- pada periode yang sama akan bentrok (ERROR 1062) — rollback berhenti di
-- tengah. Kasus ini sudah diuji.
--
-- URUTAN PENTING (kedua): FK `fk_invoices_customer` butuh index pada
-- `customer_id`. Migrasi 032 membuat uq_invoices_period yang menggantikan index
-- implisit `fk_invoices_customer` (MariaDB melepasnya karena duplikat), jadi
-- index itu WAJIB dibuat ulang sebelum unique key dilepas. Tanpa langkah ini
-- rollback gagal dengan ERROR 1553 "Cannot drop index ...: needed in a foreign
-- key constraint".
--
-- RISIKO ROLLBACK: status void tidak bisa dibedakan lagi dari unpaid setelah
-- rollback, sehingga jejak pembatalan hanya tersisa di finance_events (yang
-- ikut dibuang pada langkah terakhir). Jalankan hanya pada database uji.

-- 1) Lepas unique key + foreign key lebih dulu.
SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE table_schema = DATABASE() AND table_name = 'invoices'
                AND constraint_name = 'fk_invoices_voided_by');
SET @sql := IF(@has > 0, 'ALTER TABLE invoices DROP FOREIGN KEY fk_invoices_voided_by', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE table_schema = DATABASE() AND table_name = 'invoices'
                AND index_name = 'fk_invoices_voided_by');
SET @sql := IF(@has > 0, 'ALTER TABLE invoices DROP INDEX fk_invoices_voided_by', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1b) Kembalikan index penopang FK customer_id (dilepas otomatis oleh 032).
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE table_schema = DATABASE() AND table_name = 'invoices'
                AND index_name = 'fk_invoices_customer');
SET @sql := IF(@has = 0, 'ALTER TABLE invoices ADD INDEX fk_invoices_customer (customer_id)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE table_schema = DATABASE() AND table_name = 'invoices'
                AND index_name = 'uq_invoices_period');
SET @sql := IF(@has > 0, 'ALTER TABLE invoices DROP INDEX uq_invoices_period', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Status void harus hilang sebelum ENUM dikecilkan.
UPDATE invoices SET status = 'unpaid' WHERE status = 'void';

ALTER TABLE invoices
  MODIFY status ENUM('unpaid', 'paid', 'overdue', 'partial') NOT NULL DEFAULT 'unpaid';

-- 3) Buang kolom tambahan.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'void_reason') > 0,
  'ALTER TABLE invoices DROP COLUMN void_reason', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'voided_by') > 0,
  'ALTER TABLE invoices DROP COLUMN voided_by', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'voided_at') > 0,
  'ALTER TABLE invoices DROP COLUMN voided_at', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'period_key') > 0,
  'ALTER TABLE invoices DROP COLUMN period_key', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'period_end') > 0,
  'ALTER TABLE invoices DROP COLUMN period_end', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'period_start') > 0,
  'ALTER TABLE invoices DROP COLUMN period_start', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Tabel jejak keuangan.
DROP TABLE IF EXISTS finance_events;
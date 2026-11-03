-- rollback/036_customer_credit_limit_down.sql
-- Aman: hanya menghapus kolom batas kredit. Tagihan, pembayaran, dan
-- perpanjangan tetap utuh. Idempoten.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE table_schema = DATABASE() AND table_name = 'customers'
                AND column_name = 'credit_limit');
SET @sql := IF(@has > 0, 'ALTER TABLE customers DROP COLUMN credit_limit', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
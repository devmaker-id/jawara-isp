-- 014_radius_centric.sql
-- Menjadikan RADIUS sebagai dapur: satu akun (radcheck.username) adalah
-- identitas layanan, dan tagihan menunjuk akun itu — bukan hanya pelanggan.
--
-- Tanpa kolom ini, invoice hanya tahu SIAPA yang menagih (customer_id) tetapi
-- tidak tahu LAYANAN mana yang ditagih, sehingga pembayaran tidak bisa
-- memengaruhi status akun di RADIUS.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. invoices.username — akun RADIUS yang ditagih
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND column_name = 'username') = 0,
  "ALTER TABLE invoices ADD COLUMN username VARCHAR(64) NULL AFTER customer_id",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE table_schema = DATABASE() AND table_name = 'invoices'
                   AND index_name = 'idx_invoices_username') = 0,
  "ALTER TABLE invoices ADD INDEX idx_invoices_username (username)",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Indeks penghubung akun ↔ pelanggan ↔ sesi
--    Tanpa indeks ini, halaman pelanggan dan dashboard memindai seluruh
--    radacct (tabel yang paling cepat membesar).
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND index_name = 'idx_vouchers_customer') = 0,
  "ALTER TABLE radius_vouchers ADD INDEX idx_vouchers_customer (customer_id)",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND index_name = 'idx_vouchers_username') = 0,
  "ALTER TABLE radius_vouchers ADD INDEX idx_vouchers_username (username)",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE table_schema = DATABASE() AND table_name = 'radacct'
                   AND index_name = 'idx_radacct_username') = 0,
  "ALTER TABLE radacct ADD INDEX idx_radacct_username (username)",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE table_schema = DATABASE() AND table_name = 'radacct'
                   AND index_name = 'idx_radacct_open') = 0,
  "ALTER TABLE radacct ADD INDEX idx_radacct_open (acctstoptime)",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Isi username pada tagihan lama dari akun yang sudah tertaut ke pelanggan.
--    Hanya bila tepat satu akun tertaut — kalau lebih, pemiliknya ambigu dan
--    lebih jujur dibiarkan NULL daripada menebak.
-- ---------------------------------------------------------------------------
UPDATE invoices i
   SET i.username = (
     SELECT v.username FROM radius_vouchers v
      WHERE v.customer_id = i.customer_id
      GROUP BY v.customer_id
     HAVING COUNT(*) = 1
   )
 WHERE i.username IS NULL
   AND (SELECT COUNT(*) FROM radius_vouchers v WHERE v.customer_id = i.customer_id) = 1;

-- ---------------------------------------------------------------------------
-- 4. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig014_gate;

DELIMITER //
CREATE PROCEDURE _mig014_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_idx INT DEFAULT 0;

  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'invoices' AND column_name = 'username';
  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '014: invoices.username belum ada';
  END IF;

  SELECT COUNT(*) INTO v_idx FROM information_schema.STATISTICS
   WHERE table_schema = DATABASE() AND table_name = 'radacct' AND index_name = 'idx_radacct_username';
  IF v_idx = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '014: indeks radacct.username belum ada';
  END IF;
END//
DELIMITER ;

CALL _mig014_gate();
DROP PROCEDURE _mig014_gate;

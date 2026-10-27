-- 016_customer_radius_account.sql
-- Pelanggan punya akun RADIUS yang dibuat langsung dari halaman /customers,
-- lengkap dengan limitasi per user.
--
-- Kenapa limitasi disimpan di radius_vouchers (baris akun), bukan di profil:
-- atribut di radgroupreply berlaku untuk SEMUA user dalam grup profil itu.
-- Limit waktu/kuota milik satu pelanggan harus per-user → ditulis ke radreply.
-- Kolom di sini menyimpan NIAT-nya supaya panel bisa menampilkan dan menulis
-- ulang atribut saat pelanggan diubah.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. customers.status: aktif / expired / suspend / disable
--    is_active tetap dipertahankan (dipakai filter lama) dan selalu disinkronkan:
--    status 'active' → is_active 1, selain itu 0.
-- ---------------------------------------------------------------------------
SET @has_status := (SELECT COUNT(*) FROM information_schema.COLUMNS
                     WHERE table_schema = DATABASE() AND table_name = 'customers'
                       AND column_name = 'status');
SET @sql := IF(@has_status = 0,
  "ALTER TABLE customers ADD COLUMN status ENUM('active','expired','suspend','disable') NOT NULL DEFAULT 'active' AFTER is_active",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Isi awal dari kolom boolean lama.
UPDATE customers SET status = IF(is_active = 1, 'active', 'disable');

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE table_schema = DATABASE() AND table_name = 'customers'
                   AND index_name = 'idx_customers_status') = 0,
  "ALTER TABLE customers ADD INDEX idx_customers_status (status)",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Limitasi per akun RADIUS
--    time_limit_seconds : batas durasi satu sesi (Session-Timeout)
--    quota_limit_bytes  : batas total pemakaian (Mikrotik-Total-Limit)
--    NULL = tidak dibatasi.
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND column_name = 'time_limit_seconds') = 0,
  "ALTER TABLE radius_vouchers ADD COLUMN time_limit_seconds INT UNSIGNED NULL AFTER expires_at",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND column_name = 'quota_limit_bytes') = 0,
  "ALTER TABLE radius_vouchers ADD COLUMN quota_limit_bytes BIGINT UNSIGNED NULL AFTER time_limit_seconds",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig016_gate;

DELIMITER //
CREATE PROCEDURE _mig016_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_bad INT DEFAULT 0;

  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'status';
  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '016: customers.status belum ada';
  END IF;

  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
     AND column_name IN ('time_limit_seconds','quota_limit_bytes');
  IF v_col <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '016: kolom limitasi akun belum lengkap';
  END IF;

  -- is_active harus konsisten dengan status.
  SELECT COUNT(*) INTO v_bad FROM customers
   WHERE (status = 'active' AND is_active <> 1) OR (status <> 'active' AND is_active <> 0);
  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '016: is_active tidak sinkron dengan status';
  END IF;
END//
DELIMITER ;

CALL _mig016_gate();
DROP PROCEDURE _mig016_gate;

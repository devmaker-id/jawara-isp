-- 012_group_pool.sql
-- Group Profile boleh membuat IP pool sendiri di router (per grup), bukan hanya
-- menunjuk pool yang sudah ada.
--
--   pool_mode:
--     mikrotik-pool = pakai pool yang SUDAH ada di router (pilih nama)
--     sql-ippool    = pool dikelola RADIUS (Framed-Pool dari SQL)
--     group-pool    = panel MEMBUAT pool khusus grup ini di router
--
-- Untuk `group-pool` dibutuhkan rentang alamat; PPP juga butuh local-address
-- (gateway sesi) yang TIDAK boleh berada di dalam rentang pool.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. pool_mode: tambah 'group-pool' di AKHIR daftar (ordinal lama tidak bergeser)
-- ---------------------------------------------------------------------------
SET @has_group_pool := (SELECT COUNT(*) FROM information_schema.COLUMNS
                         WHERE table_schema = DATABASE()
                           AND table_name   = 'group_profiles'
                           AND column_name  = 'pool_mode'
                           AND column_type LIKE '%group-pool%');

SET @sql := IF(@has_group_pool = 0,
  "ALTER TABLE group_profiles MODIFY pool_mode ENUM('mikrotik-pool','sql-ippool','group-pool') NOT NULL DEFAULT 'mikrotik-pool'",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Kolom rentang pool (dijaga information_schema agar bisa dijalankan ulang)
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'group_profiles'
                   AND column_name = 'pool_local_address') = 0,
  "ALTER TABLE group_profiles ADD COLUMN pool_local_address VARCHAR(45) NULL AFTER mikrotik_pool_name",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'group_profiles'
                   AND column_name = 'pool_range_start') = 0,
  "ALTER TABLE group_profiles ADD COLUMN pool_range_start VARCHAR(45) NULL AFTER pool_local_address",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'group_profiles'
                   AND column_name = 'pool_range_end') = 0,
  "ALTER TABLE group_profiles ADD COLUMN pool_range_end VARCHAR(45) NULL AFTER pool_range_start",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Penanda bahwa pool dibuat oleh panel (bukan pool milik operator), supaya
-- penghapusan grup tahu apakah pool boleh dihapus.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'group_profiles'
                   AND column_name = 'pool_created') = 0,
  "ALTER TABLE group_profiles ADD COLUMN pool_created TINYINT(1) NOT NULL DEFAULT 0 AFTER pool_range_end",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig012_gate;

DELIMITER //
CREATE PROCEDURE _mig012_gate()
BEGIN
  DECLARE v_mode VARCHAR(255) DEFAULT '';
  DECLARE v_cols INT DEFAULT 0;

  SELECT column_type INTO v_mode FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'group_profiles' AND column_name = 'pool_mode';
  IF v_mode NOT LIKE '%group-pool%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '012: pool_mode belum memuat group-pool';
  END IF;

  SELECT COUNT(*) INTO v_cols FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'group_profiles'
     AND column_name IN ('pool_local_address','pool_range_start','pool_range_end','pool_created');
  IF v_cols <> 4 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '012: kolom pool belum lengkap (harus 4)';
  END IF;
END//
DELIMITER ;

CALL _mig012_gate();
DROP PROCEDURE _mig012_gate;

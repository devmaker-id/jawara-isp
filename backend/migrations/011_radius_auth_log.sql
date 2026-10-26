-- 011_radius_auth_log.sql
--
-- Menambah kolom identitas perangkat pada radpostauth, supaya halaman
-- "FreeRADIUS -> Log Autentikasi" bisa difilter per IP NAS, MAC, interface,
-- dan station (SSID/BSSID).
--
-- Idempotent: setiap ALTER dijaga information_schema, jadi aman dijalankan
-- ulang. Tidak ada DROP dan tidak ada data yang diubah.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
                AND column_name = 'nasipaddress');
SET @sql := IF(@has = 0,
  'ALTER TABLE radpostauth ADD COLUMN nasipaddress VARCHAR(45) NOT NULL DEFAULT ''''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
                AND column_name = 'nasportid');
SET @sql := IF(@has = 0,
  'ALTER TABLE radpostauth ADD COLUMN nasportid VARCHAR(64) NOT NULL DEFAULT ''''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
                AND column_name = 'nasporttype');
SET @sql := IF(@has = 0,
  'ALTER TABLE radpostauth ADD COLUMN nasporttype VARCHAR(32) NOT NULL DEFAULT ''''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
                AND column_name = 'framedipaddress');
SET @sql := IF(@has = 0,
  'ALTER TABLE radpostauth ADD COLUMN framedipaddress VARCHAR(45) NOT NULL DEFAULT ''''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indeks untuk filter dan urutan.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
                AND index_name = 'idx_radpostauth_nas');
SET @sql := IF(@has = 0,
  'ALTER TABLE radpostauth ADD INDEX idx_radpostauth_nas (nasipaddress)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
                AND index_name = 'idx_radpostauth_mac');
SET @sql := IF(@has = 0,
  'ALTER TABLE radpostauth ADD INDEX idx_radpostauth_mac (callingstationid)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Gerbang: gagal keras bila ada kolom yang belum terpasang.
DROP PROCEDURE IF EXISTS _mig011_gate;
DELIMITER //
CREATE PROCEDURE _mig011_gate()
BEGIN
  DECLARE v_cols INT DEFAULT 0;
  SELECT COUNT(*) INTO v_cols FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
     AND column_name IN ('nasipaddress', 'nasportid', 'nasporttype', 'framedipaddress');
  IF v_cols <> 4 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'radpostauth belum lengkap: kolom log autentikasi kurang.';
  END IF;
END //
DELIMITER ;

CALL _mig011_gate();
DROP PROCEDURE _mig011_gate;

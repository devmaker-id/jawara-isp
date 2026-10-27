-- 017_group_limits.sql
-- Keputusan final: limitasi melekat pada GRUP (profil layanan), bukan per user.
--
-- Alasannya bukan teknis semata: satu grup = satu paket jual. Semua pelanggan
-- dalam paket yang sama harus dapat batas yang sama, dan operator cukup
-- mengubahnya di satu tempat.
--
-- Konsekuensi yang dijalankan di sini:
--   1. Kolom limitasi per akun (radius_vouchers) DIHAPUS — nilainya tidak lagi
--      dibaca kode mana pun setelah perubahan ini.
--   2. ppp_profiles mendapat kolom limitasi grup, karena sebelumnya hanya
--      hotspot yang punya (timebase/quotabase). Tanpa ini "per grup" hanya
--      berlaku untuk hotspot.
--
-- Atribut grup ditulis ke radgroupreply (berlaku untuk semua user di grup),
-- bukan radreply (per user).
--
-- Sifat: idempoten.

-- ---------------------------------------------------------------------------
-- 1. Hapus limitasi per akun
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND column_name = 'time_limit_seconds') > 0,
  'ALTER TABLE radius_vouchers DROP COLUMN time_limit_seconds',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND column_name = 'quota_limit_bytes') > 0,
  'ALTER TABLE radius_vouchers DROP COLUMN quota_limit_bytes',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Limitasi grup untuk PPP
--    NULL = tidak dibatasi.
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'ppp_profiles'
                   AND column_name = 'time_limit_seconds') = 0,
  "ALTER TABLE ppp_profiles ADD COLUMN time_limit_seconds INT UNSIGNED NULL AFTER priority",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'ppp_profiles'
                   AND column_name = 'quota_limit_bytes') = 0,
  "ALTER TABLE ppp_profiles ADD COLUMN quota_limit_bytes BIGINT UNSIGNED NULL AFTER time_limit_seconds",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig017_gate;

DELIMITER //
CREATE PROCEDURE _mig017_gate()
BEGIN
  DECLARE v_old INT DEFAULT 0;
  DECLARE v_new INT DEFAULT 0;

  SELECT COUNT(*) INTO v_old FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
     AND column_name IN ('time_limit_seconds','quota_limit_bytes');
  IF v_old > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '017: kolom limitasi per akun masih ada';
  END IF;

  SELECT COUNT(*) INTO v_new FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'ppp_profiles'
     AND column_name IN ('time_limit_seconds','quota_limit_bytes');
  IF v_new <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '017: kolom limitasi grup PPP belum lengkap';
  END IF;
END//
DELIMITER ;

CALL _mig017_gate();
DROP PROCEDURE _mig017_gate;

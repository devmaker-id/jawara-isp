-- 021_bandwidth_priority_default.sql
-- Prioritas queue MikroTik: 1 = paling tinggi, 8 = paling rendah.
-- Default lama 1 membuat setiap bandwidth baru otomatis mendapat prioritas
-- TERTINGGI, padahal pelanggan biasa seharusnya berbagi di prioritas terendah.
-- Default diubah ke 8 (angka terbesar = prioritas paling rendah).
--
-- Data yang sudah ada TIDAK diubah: mengubah prioritas bandwidth yang sedang
-- dipakai akan menggeser antrean pelanggan yang sedang berjalan.
--
-- Sifat: additive + idempoten.

SET @default_now := (
  SELECT COLUMN_DEFAULT FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'bandwidth_profiles'
     AND column_name = 'priority'
);

SET @sql := IF(@default_now <> '8',
  'ALTER TABLE bandwidth_profiles ALTER COLUMN priority SET DEFAULT 8',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP PROCEDURE IF EXISTS _mig021_gate;

DELIMITER //
CREATE PROCEDURE _mig021_gate()
BEGIN
  DECLARE v_default VARCHAR(32);

  SELECT COLUMN_DEFAULT INTO v_default FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'bandwidth_profiles'
     AND column_name = 'priority';

  IF v_default <> '8' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '021: default priority bandwidth bukan 8';
  END IF;
END//
DELIMITER ;

CALL _mig021_gate();
DROP PROCEDURE _mig021_gate;
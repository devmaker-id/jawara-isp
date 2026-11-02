-- 034_config_value_mediumtext.sql
-- Template voucher menyimpan HTML lengkap (bisa >1.000 baris) dalam satu nilai
-- JSON di config. Kolom config_value bertipe TEXT (maks 65.535 byte), sehingga
-- template panjang ditolak database. MEDIUMTEXT memberi ruang sampai 16 MB.
--
-- AMAN: hanya tipe kolom; isi nilai yang ada tidak diubah. Idempoten.

SET @type := (
  SELECT DATA_TYPE FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'config' AND column_name = 'config_value'
);

SET @sql := IF(@type <> 'mediumtext',
  'ALTER TABLE config MODIFY config_value MEDIUMTEXT NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Bukti:
-- SELECT DATA_TYPE FROM information_schema.columns
--  WHERE table_schema = DATABASE() AND table_name='config' AND column_name='config_value';
-- -- mediumtext

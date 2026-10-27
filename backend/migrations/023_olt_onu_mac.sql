-- 023_olt_onu_mac.sql
-- Kolom MAC ONU + waktu baca redaman.
--
-- Vendor berbeda memberi identitas ONU yang berbeda:
--   VSOL/GLOBAL  → serial number GPON (ZICG..., ZTEG...)
--   HiFocus/Hioso → MAC address ONU (a4:f3:3b:61:77:bb)
--
-- Menyimpan keduanya di satu kolom membuat data tidak bisa dipercaya: "serial"
-- yang isinya MAC akan gagal dicocokkan dengan OLT mana pun. Jadi dipisah.
--
-- `optical_read_at` menandai kapan redaman ONU terakhir dibaca. Vendor yang
-- butuh satu perintah per ONU (HiFocus) dibaca bertahap, bukan seluruhnya
-- sekaligus, supaya satu permintaan sync tidak menggantung lama.
--
-- Sifat: additive + idempoten.

SET @has_mac := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND column_name = 'onu_mac'
);
SET @sql := IF(
  @has_mac = 0,
  'ALTER TABLE olt_onus ADD COLUMN onu_mac VARCHAR(20) NULL AFTER serial_number',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_optical := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND column_name = 'optical_read_at'
);
SET @sql := IF(
  @has_optical = 0,
  'ALTER TABLE olt_onus ADD COLUMN optical_read_at DATETIME NULL AFTER tx_bias',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND index_name = 'idx_olt_onus_optical'
);
SET @sql := IF(
  @has_idx = 0,
  'ALTER TABLE olt_onus ADD KEY idx_olt_onus_optical (olt_id, optical_read_at)',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
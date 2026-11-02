-- rollback/031_olt_onu_missing_down.sql
-- Membatalkan penanda "hilang" pada inventori ONU.
-- Aman: tidak ada data pelanggan/relasi yang disentuh; hanya kolom penanda.
-- Sifat: idempoten.

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND index_name = 'idx_olt_onus_missing');
SET @sql := IF(@has_idx > 0,
  'ALTER TABLE olt_onus DROP INDEX idx_olt_onus_missing',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND column_name = 'missing_at');
SET @sql := IF(@has_col > 0,
  'ALTER TABLE olt_onus DROP COLUMN missing_at',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
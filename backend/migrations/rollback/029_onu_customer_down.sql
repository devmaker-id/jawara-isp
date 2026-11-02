-- rollback/029_onu_customer_down.sql
-- Membatalkan migrasi 029. JALANKAN HANYA BILA DIMINTA.
--
-- PERINGATAN: relasi ONU->pelanggan dan riwayat pemasangan ikut hilang.
-- Sebelum rollback, simpan dulu:
--   SELECT id, customer_id, olt_id, port_id, onu_id, serial_number FROM olt_onus WHERE customer_id IS NOT NULL;
--   SELECT * FROM onu_assignment_history;
--
-- Telemetri di olt_onus tidak dihapus oleh rollback ini.
-- Sifat: idempoten.

SET @has_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                 WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                   AND constraint_name = 'fk_olt_onus_customer');
SET @sql := IF(@has_fk > 0,
  'ALTER TABLE olt_onus DROP FOREIGN KEY fk_olt_onus_customer',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND index_name = 'uq_onus_customer');
SET @sql := IF(@has_idx > 0,
  'ALTER TABLE olt_onus DROP INDEX uq_onus_customer',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND column_name = 'customer_id');
SET @sql := IF(@has_col > 0,
  'ALTER TABLE olt_onus DROP COLUMN customer_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS onu_assignment_history;

-- 031_olt_onu_missing.sql
-- ONU tidak lagi DIHAPUS saat sinkronisasi. Baris yang tidak terlihat pada
-- port yang benar-benar terbaca ditandai `missing_at` (NULL = masih ada di
-- perangkat). Identitas ONU dan relasi pelanggannya tetap utuh, sehingga:
--   * pelanggan yang ONU-nya gagal terbaca tidak kehilangan data,
--   * gangguan sinkronisasi sesaat tidak menghapus inventori,
--   * riwayat pemasangan tetap bisa dirujuk.
--
-- Sifat: additive + idempoten. Tidak ada baris yang dihapus/diubah isinya.

ALTER TABLE olt_onus ADD COLUMN IF NOT EXISTS missing_at DATETIME NULL AFTER last_seen_at;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND index_name = 'idx_olt_onus_missing');
SET @sql := IF(@has_idx = 0,
  'ALTER TABLE olt_onus ADD KEY idx_olt_onus_missing (olt_id, missing_at)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Gate: kolom & indeks harus ada.
DROP PROCEDURE IF EXISTS _mig031_gate;
DELIMITER //
CREATE PROCEDURE _mig031_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_idx INT DEFAULT 0;
  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND column_name = 'missing_at';
  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '031: olt_onus.missing_at belum ada';
  END IF;
  SELECT COUNT(*) INTO v_idx FROM information_schema.STATISTICS
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND index_name = 'idx_olt_onus_missing';
  IF v_idx = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '031: idx_olt_onus_missing belum ada';
  END IF;
END//
DELIMITER ;
CALL _mig031_gate();
DROP PROCEDURE _mig031_gate;
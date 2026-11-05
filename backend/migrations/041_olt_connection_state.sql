-- ============================================================================
-- 041_olt_connection_state.sql
-- Klasifikasi penyebab status ONU non-online, dari bacaan langsung perangkat:
--   ONLINE / OFFLINE / ONU_POWER_OFF / FIBER_LOS / ONU_AUTH_FAILED / UNKNOWN.
--
-- Sumber nilainya:
--   * HiFocus/Hioso (EPON) : kolom `ctcStatus` di `show onu info epon <port> all`
--     (CtcNegDone=ONLINE, MpcpDiscovery=ONU_POWER_OFF, --=FIBER_LOS,
--     CtcInfo=ONU_AUTH_FAILED) — ditulis oleh sinkronisasi inventori.
--   * VSOL/Global (GPON)   : event syslog (ONU Online/Offline/Dying Gasp/Port Los)
--     — ditulis oleh handler syslog, karena `show onu state` tidak membedakan sebab.
--
-- Kolom opsional (NULL = belum diklasifikasi), tidak memengaruhi `online`/`phase_state`.
-- Sifat: additive + idempoten.
-- ============================================================================

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND column_name = 'connection_state');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE olt_onus ADD COLUMN connection_state VARCHAR(30) NULL AFTER phase_state',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Gate: pastikan kolom terpasang, kalau tidak gagal terang-terangan.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig041_gate;
DELIMITER //
CREATE PROCEDURE _mig041_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND column_name = 'connection_state';
  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '041: olt_onus.connection_state belum ada';
  END IF;
END//
DELIMITER ;
CALL _mig041_gate();
DROP PROCEDURE _mig041_gate;
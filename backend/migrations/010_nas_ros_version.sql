-- 010_nas_ros_version.sql
-- Menambah `nas.ros_version` supaya panel bisa membedakan perilaku RouterOS 6 dan 7.
--
-- Alasan: RouterOS 7.15+ menambahkan `require-message-auth` (default
-- yes-for-request-resp) sehingga Access-Accept/Reject dari server RADIUS WAJIB
-- membawa Message-Authenticator. RouterOS 6 tidak punya opsi itu dan tidak
-- memintanya. Karena itu `nas.require_ma` diturunkan dari `ros_version`
-- (satu sumber kebenaran) dan tidak lagi diisi manual.
--
-- Sifat: additive + idempoten. Aman dijalankan dua kali, tidak menyentuh tabel lain.
--
-- Rollback:
--   ALTER TABLE nas DROP COLUMN ros_version;

-- ---------------------------------------------------------------------------
-- 1. Tambah kolom (dijaga information_schema, bukan ADD COLUMN IF NOT EXISTS)
-- ---------------------------------------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE table_schema = DATABASE()
                    AND table_name   = 'nas'
                    AND column_name  = 'ros_version');

SET @sql := IF(@has_col = 0,
  "ALTER TABLE nas ADD COLUMN ros_version ENUM('6','7') NOT NULL DEFAULT '6' AFTER require_ma",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Sinkronkan require_ma dengan ros_version
-- ---------------------------------------------------------------------------
UPDATE nas SET require_ma = IF(ros_version = '7', 1, 0);

-- ---------------------------------------------------------------------------
-- 3. Gate: gagal keras kalau kolom hilang atau nilainya tidak sinkron
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig010_gate;

DELIMITER //
CREATE PROCEDURE _mig010_gate()
BEGIN
  DECLARE v_cols INT DEFAULT 0;
  DECLARE v_bad  INT DEFAULT 0;

  SELECT COUNT(*) INTO v_cols FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE()
     AND table_name   = 'nas'
     AND column_name  = 'ros_version';

  IF v_cols <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '010: kolom nas.ros_version tidak ada';
  END IF;

  SELECT COUNT(*) INTO v_bad FROM nas
   WHERE require_ma <> IF(ros_version = '7', 1, 0);

  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '010: require_ma tidak sinkron dengan ros_version';
  END IF;
END//
DELIMITER ;

CALL _mig010_gate();
DROP PROCEDURE _mig010_gate;

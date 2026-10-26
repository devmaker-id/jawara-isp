-- 011_radius_authoritative.sql
-- Model A: RADIUS adalah sumber kebenaran atribut AAA.
--
-- Perubahan:
--   1. radius_vouchers.user_type menerima 'member' (akun langganan ber-username
--      DAN password). 'voucher' tetap berarti username = password.
--      'customer' dipertahankan di akhir daftar ENUM agar ordinal lama tidak
--      bergeser, tetapi tidak ditulis lagi oleh aplikasi.
--   2. group_profiles.parent_queue mendapat nilai sentinel 'DEFAULT' untuk
--      "tidak memakai parent queue" — sebagian besar lokasi tidak menyetelnya.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. user_type: tambah 'member' di AKHIR daftar (ordinal lama tidak bergeser)
-- ---------------------------------------------------------------------------
SET @has_member := (SELECT COUNT(*) FROM information_schema.COLUMNS
                     WHERE table_schema = DATABASE()
                       AND table_name   = 'radius_vouchers'
                       AND column_name  = 'user_type'
                       AND column_type LIKE '%member%');

SET @sql := IF(@has_member = 0,
  "ALTER TABLE radius_vouchers MODIFY user_type ENUM('voucher','customer','member') NOT NULL DEFAULT 'voucher'",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Akun lama bertipe 'customer' menjadi 'member'.
UPDATE radius_vouchers SET user_type = 'member' WHERE user_type = 'customer';

-- ---------------------------------------------------------------------------
-- 2. parent_queue: kosong/NULL berarti DEFAULT (tanpa parent queue)
-- ---------------------------------------------------------------------------
UPDATE group_profiles
   SET parent_queue = 'DEFAULT'
 WHERE parent_queue IS NULL OR TRIM(parent_queue) = '';

-- ---------------------------------------------------------------------------
-- 3. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig011_gate;

DELIMITER //
CREATE PROCEDURE _mig011_gate()
BEGIN
  DECLARE v_type VARCHAR(255) DEFAULT '';
  DECLARE v_old  INT DEFAULT 0;

  SELECT column_type INTO v_type FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers' AND column_name = 'user_type';

  IF v_type NOT LIKE '%member%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '011: user_type belum memuat member';
  END IF;

  SELECT COUNT(*) INTO v_old FROM radius_vouchers WHERE user_type = 'customer';
  IF v_old > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '011: masih ada akun bertipe customer';
  END IF;
END//
DELIMITER ;

CALL _mig011_gate();
DROP PROCEDURE _mig011_gate;

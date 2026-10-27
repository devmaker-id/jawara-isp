-- 015_voucher_customer_constraint.sql
-- Memperbaiki constraint `ck_voucher_customer`.
--
-- Migrasi 007 menulis aturannya untuk `user_type = 'customer'`, sedangkan kode
-- dan UI memakai `user_type = 'member'`. Akibatnya SETIAP pembuatan akun milik
-- pelanggan ditolak database:
--
--   CONSTRAINT `ck_voucher_customer` failed for `isp_billing`.`radius_vouchers`
--
-- Aturan yang benar: voucher tidak punya pemilik, member (dan nama lama
-- 'customer' yang mungkin masih tersisa) wajib punya pemilik.
--
-- Sifat: idempoten (constraint selalu dihapus lalu dibuat ulang).

-- ---------------------------------------------------------------------------
-- 1. Hapus constraint lama
-- ---------------------------------------------------------------------------
SET @has_chk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'radius_vouchers'
     AND constraint_name = 'ck_voucher_customer'
);
SET @sql := IF(@has_chk > 0,
  'ALTER TABLE radius_vouchers DROP CONSTRAINT ck_voucher_customer',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Samakan nama tipe yang tertinggal: 'customer' -> 'member'
--    (dijalankan sebelum constraint baru agar data lama tidak melanggar)
-- ---------------------------------------------------------------------------
UPDATE radius_vouchers SET user_type = 'member' WHERE user_type = 'customer';

-- ---------------------------------------------------------------------------
-- 3. Constraint baru
-- ---------------------------------------------------------------------------
ALTER TABLE radius_vouchers
  ADD CONSTRAINT ck_voucher_customer CHECK (
    (user_type = 'voucher' AND customer_id IS NULL)
    OR (user_type = 'member' AND customer_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 4. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig015_gate;

DELIMITER //
CREATE PROCEDURE _mig015_gate()
BEGIN
  DECLARE v_def LONGTEXT DEFAULT '';
  DECLARE v_bad INT DEFAULT 0;

  SELECT CHECK_CLAUSE INTO v_def FROM information_schema.CHECK_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'ck_voucher_customer';
  IF v_def NOT LIKE '%member%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '015: constraint belum memuat member';
  END IF;

  -- Tidak boleh ada baris yang melanggar aturan baru.
  SELECT COUNT(*) INTO v_bad FROM radius_vouchers
   WHERE (user_type = 'voucher' AND customer_id IS NOT NULL)
      OR (user_type = 'member'  AND customer_id IS NULL);
  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '015: ada baris voucher/member yang tidak konsisten';
  END IF;
END//
DELIMITER ;

CALL _mig015_gate();
DROP PROCEDURE _mig015_gate;

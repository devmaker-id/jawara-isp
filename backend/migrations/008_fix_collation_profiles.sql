-- ============================================================================
-- 008_fix_collation_profiles.sql
-- Menyeragamkan collation tabel yang dibuat oleh 006.
--
-- Masalah yang diperbaiki:
--   006 membuat tabel dengan DEFAULT CHARSET=utf8mb4 tanpa COLLATE, sehingga
--   MariaDB memakai utf8mb4_general_ci, sedangkan database memakai
--   utf8mb4_unicode_ci. Akibatnya JOIN antar tabel gagal:
--     ERROR 1267 (HY000): Illegal mix of collations ... for operation '='
--   Contoh nyata: membersihkan radcheck dengan JOIN radius_vouchers.username.
--
-- Dampak: hanya metadata collation. Tidak ada baris yang diubah/dihapus.
-- Rollback: ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
-- ============================================================================

ALTER TABLE bandwidth_profiles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE group_profiles     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE hotspot_profiles   CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ppp_profiles       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE radius_vouchers    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE radippool          CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Verifikasi: seluruh tabel harus memakai collation yang sama dengan database.
DELIMITER $$
CREATE PROCEDURE _mig008_verify()
BEGIN
  DECLARE v_bad INT DEFAULT 0;

  SELECT COUNT(*) INTO v_bad
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('bandwidth_profiles','group_profiles','hotspot_profiles',
                        'ppp_profiles','radius_vouchers','radippool',
                        'radcheck','radusergroup','radgroupreply')
     AND table_collation <> 'utf8mb4_unicode_ci';

  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 008 gagal: masih ada tabel dengan collation berbeda.';
  END IF;
END$$
CALL _mig008_verify()$$
DROP PROCEDURE _mig008_verify$$
DELIMITER ;

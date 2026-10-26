-- ============================================================================
-- 007_voucher_user_type.sql
-- Membedakan tipe akun pada tabel radius_vouchers:
--   voucher  → akun lepas (dijual sebagai voucher), tanpa pelanggan
--   customer → akun langganan milik satu pelanggan (wajib customer_id)
--
-- Berlaku untuk hotspot maupun PPP.
--
-- STATUS: belum dijalankan. Backup dulu.
-- Sifat migrasi:
--   * Hanya menambah kolom + constraint pada radius_vouchers.
--   * TIDAK menghapus/mengubah baris tabel lain.
--   * Data lama otomatis menjadi user_type='voucher' (default).
-- Rollback:
--   ALTER TABLE radius_vouchers DROP CHECK ck_voucher_customer;
--   ALTER TABLE radius_vouchers DROP INDEX idx_voucher_user_type;
--   ALTER TABLE radius_vouchers DROP COLUMN user_type;
-- ============================================================================

-- 1. Tambah kolom bila belum ada.
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'radius_vouchers'
     AND column_name = 'user_type'
);

SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE radius_vouchers
     ADD COLUMN user_type ENUM(''voucher'',''customer'') NOT NULL DEFAULT ''voucher'' AFTER profile_name',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Baris lama tanpa pelanggan dianggap voucher; yang punya customer_id
--    dianggap langganan agar datanya konsisten dengan aturan baru.
UPDATE radius_vouchers
   SET user_type = 'customer'
 WHERE customer_id IS NOT NULL AND user_type = 'voucher';

UPDATE radius_vouchers
   SET customer_id = NULL
 WHERE user_type = 'voucher' AND customer_id IS NOT NULL;

-- 3. Index untuk filter tipe akun.
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'radius_vouchers'
     AND index_name = 'idx_voucher_user_type'
);
SET @sql := IF(
  @has_idx = 0,
  'ALTER TABLE radius_vouchers ADD INDEX idx_voucher_user_type (user_type, status)',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Constraint: customer WAJIB punya customer_id, voucher WAJIB tidak punya.
SET @has_chk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'radius_vouchers'
     AND constraint_name = 'ck_voucher_customer'
);
SET @sql := IF(
  @has_chk = 0,
  'ALTER TABLE radius_vouchers
     ADD CONSTRAINT ck_voucher_customer CHECK (
       (user_type = ''customer'' AND customer_id IS NOT NULL)
       OR (user_type = ''voucher'' AND customer_id IS NULL)
     )',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Nama grup RADIUS yang benar-benar dipakai tiap profil.
--    Nama profil boleh kembar antar owner, sedangkan radgroupreply memakai
--    kunci global. Kolom ini menyimpan nama grup final (nama profil, atau
--    "nama#id" bila bentrok) supaya atribut antar reseller tidak saling timpa.
SET @has_rg := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'hotspot_profiles'
     AND column_name = 'radius_group'
);
SET @sql := IF(
  @has_rg = 0,
  'ALTER TABLE hotspot_profiles ADD COLUMN radius_group VARCHAR(80) NULL AFTER name',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_rg2 := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'ppp_profiles'
     AND column_name = 'radius_group'
);
SET @sql := IF(
  @has_rg2 = 0,
  'ALTER TABLE ppp_profiles ADD COLUMN radius_group VARCHAR(80) NULL AFTER name',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Profil lama: grup RADIUS-nya masih memakai nama profil apa adanya.
UPDATE hotspot_profiles SET radius_group = name WHERE radius_group IS NULL;
UPDATE ppp_profiles SET radius_group = name WHERE radius_group IS NULL;

-- 6. Verifikasi.
DELIMITER $$
CREATE PROCEDURE _mig007_verify()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_chk INT DEFAULT 0;
  DECLARE v_rg INT DEFAULT 0;

  SELECT COUNT(*) INTO v_col FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
     AND column_name = 'user_type'
     AND column_type LIKE 'enum(''voucher'',''customer'')%';

  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 007 gagal: kolom user_type tidak sesuai.';
  END IF;

  SELECT COUNT(*) INTO v_chk FROM information_schema.table_constraints
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
     AND constraint_name = 'ck_voucher_customer';

  IF v_chk = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 007 gagal: constraint ck_voucher_customer tidak ada.';
  END IF;

  SELECT COUNT(*) INTO v_rg FROM information_schema.columns
   WHERE table_schema = DATABASE() AND column_name = 'radius_group'
     AND table_name IN ('hotspot_profiles','ppp_profiles');

  IF v_rg <> 2 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 007 gagal: kolom radius_group belum lengkap.';
  END IF;
END$$
CALL _mig007_verify()$$
DROP PROCEDURE _mig007_verify$$
DELIMITER ;

-- ============================================================================
-- 009_soften_owner_fks.sql
-- Menghilangkan risiko kehilangan data saat akun reseller dihapus.
--
-- Masalah yang diperbaiki:
--   Tabel profil memakai ON DELETE CASCADE ke users. Menghapus satu akun
--   reseller ikut menghapus SELURUH bandwidth, group, dan profil buatannya
--   secara permanen. audit_logs juga CASCADE, sehingga jejak audit hilang —
--   padahal audit justru harus bertahan.
--
-- Yang diubah:
--   bandwidth_profiles / group_profiles / hotspot_profiles / ppp_profiles
--     owner_id  : NOT NULL  → NULL (boleh tanpa pemilik)
--     FK        : CASCADE   → SET NULL
--     Alasan: data paket adalah aset, bukan pelengkap akun. Bila reseller
--     dihapus, paketnya tetap ada dan bisa ditugaskan ulang oleh admin.
--
--   audit_logs.fk_audit_logs_user
--     FK        : CASCADE   → RESTRICT
--     Alasan: riwayat audit tidak boleh hilang. Database sendiri yang menolak,
--     bukan hanya kode aplikasi.
--
-- Sifat migrasi:
--   * TIDAK menghapus atau mengubah satu baris pun.
--   * Hanya definisi foreign key + nullability kolom owner_id.
--   * Idempoten: blok yang sudah sesuai akan dilewati (DO 0).
--
-- Rollback (kembalikan seperti semula — HANYA bila yakin tidak ada owner_id NULL):
--   UPDATE bandwidth_profiles SET owner_id = 1 WHERE owner_id IS NULL;  (ulangi per tabel)
--   ALTER TABLE bandwidth_profiles DROP FOREIGN KEY fk_bw_owner;
--   ALTER TABLE bandwidth_profiles MODIFY owner_id INT NOT NULL;
--   ALTER TABLE bandwidth_profiles ADD CONSTRAINT fk_bw_owner
--     FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. bandwidth_profiles
-- ---------------------------------------------------------------------------
SET @rule := (SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'bandwidth_profiles'
                 AND CONSTRAINT_NAME = 'fk_bw_owner');
SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE bandwidth_profiles DROP FOREIGN KEY fk_bw_owner', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bandwidth_profiles'
      AND COLUMN_NAME = 'owner_id') = 'NO',
  'ALTER TABLE bandwidth_profiles MODIFY owner_id INT NULL', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE bandwidth_profiles ADD CONSTRAINT fk_bw_owner
     FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. group_profiles
-- ---------------------------------------------------------------------------
SET @rule := (SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'group_profiles'
                 AND CONSTRAINT_NAME = 'fk_group_owner');
SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE group_profiles DROP FOREIGN KEY fk_group_owner', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'group_profiles'
      AND COLUMN_NAME = 'owner_id') = 'NO',
  'ALTER TABLE group_profiles MODIFY owner_id INT NULL', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE group_profiles ADD CONSTRAINT fk_group_owner
     FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. hotspot_profiles
-- ---------------------------------------------------------------------------
SET @rule := (SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'hotspot_profiles'
                 AND CONSTRAINT_NAME = 'fk_hs_owner');
SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE hotspot_profiles DROP FOREIGN KEY fk_hs_owner', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hotspot_profiles'
      AND COLUMN_NAME = 'owner_id') = 'NO',
  'ALTER TABLE hotspot_profiles MODIFY owner_id INT NULL', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE hotspot_profiles ADD CONSTRAINT fk_hs_owner
     FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. ppp_profiles
-- ---------------------------------------------------------------------------
SET @rule := (SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ppp_profiles'
                 AND CONSTRAINT_NAME = 'fk_ppp_owner');
SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE ppp_profiles DROP FOREIGN KEY fk_ppp_owner', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ppp_profiles'
      AND COLUMN_NAME = 'owner_id') = 'NO',
  'ALTER TABLE ppp_profiles MODIFY owner_id INT NULL', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule IS NOT NULL AND @rule <> 'SET NULL',
  'ALTER TABLE ppp_profiles ADD CONSTRAINT fk_ppp_owner
     FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 5. audit_logs → RESTRICT (riwayat tidak boleh ikut terhapus)
-- ---------------------------------------------------------------------------
SET @rule := (SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
                 AND CONSTRAINT_NAME = 'fk_audit_logs_user');
SET @sql := IF(@rule IS NOT NULL AND @rule <> 'RESTRICT',
  'ALTER TABLE audit_logs DROP FOREIGN KEY fk_audit_logs_user', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@rule IS NOT NULL AND @rule <> 'RESTRICT',
  'ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_user
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 6. Verifikasi: semua FK harus sudah memakai aturan baru.
-- ---------------------------------------------------------------------------
DELIMITER $$
CREATE PROCEDURE _mig009_verify()
BEGIN
  DECLARE v_bad INT DEFAULT 0;
  DECLARE v_nullable INT DEFAULT 0;

  SELECT COUNT(*) INTO v_bad
    FROM information_schema.REFERENTIAL_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND (
       (TABLE_NAME = 'bandwidth_profiles' AND CONSTRAINT_NAME = 'fk_bw_owner'      AND DELETE_RULE <> 'SET NULL') OR
       (TABLE_NAME = 'group_profiles'     AND CONSTRAINT_NAME = 'fk_group_owner'   AND DELETE_RULE <> 'SET NULL') OR
       (TABLE_NAME = 'hotspot_profiles'   AND CONSTRAINT_NAME = 'fk_hs_owner'      AND DELETE_RULE <> 'SET NULL') OR
       (TABLE_NAME = 'ppp_profiles'       AND CONSTRAINT_NAME = 'fk_ppp_owner'     AND DELETE_RULE <> 'SET NULL') OR
       (TABLE_NAME = 'audit_logs'         AND CONSTRAINT_NAME = 'fk_audit_logs_user' AND DELETE_RULE <> 'RESTRICT')
     );

  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 009 gagal: masih ada FK dengan aturan lama.';
  END IF;

  SELECT COUNT(*) INTO v_nullable
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND COLUMN_NAME = 'owner_id'
     AND TABLE_NAME IN ('bandwidth_profiles','group_profiles','hotspot_profiles','ppp_profiles')
     AND IS_NULLABLE = 'YES';

  IF v_nullable <> 4 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 009 gagal: owner_id belum NULL-able di semua tabel profil.';
  END IF;
END$$
CALL _mig009_verify()$$
DROP PROCEDURE _mig009_verify$$
DELIMITER ;

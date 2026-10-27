-- 020_owner_and_creator.sql
-- Memisahkan dua hal yang selama ini tercampur:
--
--   owner_id    PEMILIK data  → menentukan siapa yang melihat & mengelola
--   created_by  PEMBUAT data  → siapa yang menekan Simpan (jejak, bukan hak)
--
-- Sebelum migrasi ini, `customers.reseller_id` dipakai sebagai pemilik,
-- sedangkan profil memakai `owner_id` yang selalu diisi akun yang membuat —
-- sehingga admin tidak bisa membuat profil atas nama reseller, dan nama
-- pembuat pelanggan hilang saat admin membuatkannya untuk reseller.
--
-- Sifat: additive + idempoten. Aman dijalankan berulang.

-- ---------------------------------------------------------------------------
-- 1. customers: reseller_id → owner_id (nama lama sudah menyesatkan: isinya
--    bisa admin/operator/reseller), lalu tambah created_by.
-- ---------------------------------------------------------------------------
SET @has_reseller := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'reseller_id'
);
SET @has_owner := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'owner_id'
);

SET @sql := IF(@has_reseller = 1 AND @has_owner = 0,
  'ALTER TABLE customers CHANGE COLUMN reseller_id owner_id INT(11) NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Nama indeks & kunci asing ikut diganti agar tidak ada lagi kata "reseller"
-- yang menunjuk kolom bernama lain.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'customers' AND index_name = 'idx_customers_reseller') = 1,
  'ALTER TABLE customers RENAME INDEX idx_customers_reseller TO idx_customers_owner',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'customers'
      AND constraint_name = 'fk_customers_reseller') = 1,
  'ALTER TABLE customers DROP FOREIGN KEY fk_customers_reseller',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'customers'
      AND constraint_name = 'fk_customers_owner') = 0
  AND (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'owner_id') = 1,
  'ALTER TABLE customers ADD CONSTRAINT fk_customers_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS created_by INT(11) NULL AFTER owner_id;

-- ---------------------------------------------------------------------------
-- 2. Profil & group & bandwidth: tambah created_by (owner_id sudah ada).
-- ---------------------------------------------------------------------------
ALTER TABLE hotspot_profiles  ADD COLUMN IF NOT EXISTS created_by INT(11) NULL AFTER owner_id;
ALTER TABLE ppp_profiles      ADD COLUMN IF NOT EXISTS created_by INT(11) NULL AFTER owner_id;
ALTER TABLE group_profiles    ADD COLUMN IF NOT EXISTS created_by INT(11) NULL AFTER owner_id;
ALTER TABLE bandwidth_profiles ADD COLUMN IF NOT EXISTS created_by INT(11) NULL AFTER owner_id;

-- ---------------------------------------------------------------------------
-- 3. Voucher: tambah owner_id. Voucher selama ini hanya tahu PEMBUAT, sehingga
--    reseller tidak bisa mencetak voucher miliknya tanpa menebak lewat profil.
-- ---------------------------------------------------------------------------
ALTER TABLE radius_vouchers
  ADD COLUMN IF NOT EXISTS owner_id INT(11) NULL AFTER created_by;

-- ---------------------------------------------------------------------------
-- 4. Kunci asing created_by/owner_id ke users (SET NULL: akun dihapus tidak
--    boleh menghapus data operasional).
-- ---------------------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'customers'
      AND constraint_name = 'fk_customers_creator') = 0,
  'ALTER TABLE customers ADD CONSTRAINT fk_customers_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
      AND constraint_name = 'fk_voucher_owner') = 0,
  'ALTER TABLE radius_vouchers ADD CONSTRAINT fk_voucher_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 5. Backfill created_by profil dari audit_logs.
--    Aksi *.create menyimpan {"id":<id>,"name":"..."} sehingga pembuatnya
--    bisa dipulihkan. Yang tidak punya jejak dibiarkan NULL — tidak dikarang.
-- ---------------------------------------------------------------------------
UPDATE hotspot_profiles p
  JOIN (
    SELECT MIN(a.id) AS audit_id, CAST(JSON_EXTRACT(a.details, '$.id') AS UNSIGNED) AS profile_id
      FROM audit_logs a
     WHERE a.action = 'hotspot_profile.create' AND JSON_VALID(a.details)
     GROUP BY profile_id
  ) x ON x.profile_id = p.id
  JOIN audit_logs a2 ON a2.id = x.audit_id
   SET p.created_by = a2.user_id
 WHERE p.created_by IS NULL AND x.profile_id IS NOT NULL;

UPDATE ppp_profiles p
  JOIN (
    SELECT MIN(a.id) AS audit_id, CAST(JSON_EXTRACT(a.details, '$.id') AS UNSIGNED) AS profile_id
      FROM audit_logs a
     WHERE a.action = 'ppp_profile.create' AND JSON_VALID(a.details)
     GROUP BY profile_id
  ) x ON x.profile_id = p.id
  JOIN audit_logs a2 ON a2.id = x.audit_id
   SET p.created_by = a2.user_id
 WHERE p.created_by IS NULL AND x.profile_id IS NOT NULL;

UPDATE group_profiles g
  JOIN (
    SELECT MIN(a.id) AS audit_id, CAST(JSON_EXTRACT(a.details, '$.id') AS UNSIGNED) AS group_id
      FROM audit_logs a
     WHERE a.action = 'group_profile.create' AND JSON_VALID(a.details)
     GROUP BY group_id
  ) x ON x.group_id = g.id
  JOIN audit_logs a2 ON a2.id = x.audit_id
   SET g.created_by = a2.user_id
 WHERE g.created_by IS NULL AND x.group_id IS NOT NULL;

UPDATE bandwidth_profiles b
  JOIN (
    SELECT MIN(a.id) AS audit_id, CAST(JSON_EXTRACT(a.details, '$.id') AS UNSIGNED) AS bw_id
      FROM audit_logs a
     WHERE a.action = 'bandwidth.create' AND JSON_VALID(a.details)
     GROUP BY bw_id
  ) x ON x.bw_id = b.id
  JOIN audit_logs a2 ON a2.id = x.audit_id
   SET b.created_by = a2.user_id
 WHERE b.created_by IS NULL AND x.bw_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Backfill owner_id voucher dari profilnya, lalu dari pembuatnya.
-- ---------------------------------------------------------------------------
UPDATE radius_vouchers v
  JOIN hotspot_profiles h ON v.profile_type = 'hotspot' AND h.id = v.profile_id
   SET v.owner_id = h.owner_id
 WHERE v.owner_id IS NULL;

UPDATE radius_vouchers v
  JOIN ppp_profiles p ON v.profile_type = 'ppp' AND p.id = v.profile_id
   SET v.owner_id = p.owner_id
 WHERE v.owner_id IS NULL;

UPDATE radius_vouchers SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Indeks untuk daftar & ringkasan kontribusi.
-- ---------------------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers' AND index_name = 'idx_voucher_owner') = 0,
  'ALTER TABLE radius_vouchers ADD INDEX idx_voucher_owner (owner_id, created_at)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'customers' AND index_name = 'idx_customers_creator') = 0,
  'ALTER TABLE customers ADD INDEX idx_customers_creator (created_by)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 8. Gate: kolom wajib harus ada, dan tidak boleh ada sisa nama lama.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig020_gate;

DELIMITER //
CREATE PROCEDURE _mig020_gate()
BEGIN
  DECLARE v INT DEFAULT 0;

  SELECT COUNT(*) INTO v FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'owner_id';
  IF v <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '020: customers.owner_id tidak ada';
  END IF;

  SELECT COUNT(*) INTO v FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'reseller_id';
  IF v <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '020: customers.reseller_id masih ada';
  END IF;

  SELECT COUNT(*) INTO v FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND column_name = 'created_by'
     AND table_name IN ('customers','hotspot_profiles','ppp_profiles','group_profiles','bandwidth_profiles');
  IF v <> 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '020: kolom created_by belum lengkap di 5 tabel';
  END IF;

  SELECT COUNT(*) INTO v FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers' AND column_name = 'owner_id';
  IF v <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '020: radius_vouchers.owner_id tidak ada';
  END IF;
END//
DELIMITER ;

CALL _mig020_gate();
DROP PROCEDURE _mig020_gate;

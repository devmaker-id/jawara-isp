-- 029_onu_customer.sql
-- Relasi ONU <-> pelanggan.
--
-- KEPUTUSAN YANG DIKUNCI DI SINI
--   * `olt_onus.customer_id` NULL = ONU masih inventaris (belum dipasang di
--     pelanggan). 129 ONU yang ada sekarang TETAP NULL: tidak ada satu pun
--     dipetakan otomatis dari nama ONU, karena nama ONU bukan bukti identitas.
--   * UNIQUE (customer_id) = satu pelanggan maksimal satu ONU. NULL boleh
--     berulang, jadi inventaris yang belum dipasang tetap sah.
--   * FK ON DELETE SET NULL: menghapus pelanggan tidak menghapus ONU-nya, dan
--     ONU tidak hilang dari inventaris.
--   * Telemetri (rx/tx/suhu/tegangan/online) dan identitas ONU (serial, MAC,
--     port, onu_id) TIDAK disentuh sama sekali oleh migrasi ini.
--   * Riwayat pemasangan/pelepasan/perpindahan disimpan di
--     `onu_assignment_history` sebagai snapshot teks: baris riwayat tetap
--     terbaca walau ONU-nya kemudian hilang dari hasil sync.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. Kolom relasi
-- ---------------------------------------------------------------------------
ALTER TABLE olt_onus ADD COLUMN IF NOT EXISTS customer_id INT NULL AFTER olt_id;

-- ---------------------------------------------------------------------------
-- 2. Satu pelanggan maksimal satu ONU
-- ---------------------------------------------------------------------------
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                    AND index_name = 'uq_onus_customer');
SET @sql := IF(@has_idx = 0,
  'ALTER TABLE olt_onus ADD UNIQUE KEY uq_onus_customer (customer_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Kunci asing: pelanggan dihapus -> ONU kembali jadi inventaris
-- ---------------------------------------------------------------------------
SET @has_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                 WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
                   AND constraint_name = 'fk_olt_onus_customer');
SET @sql := IF(@has_fk = 0,
  'ALTER TABLE olt_onus ADD CONSTRAINT fk_olt_onus_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 4. Riwayat pemasangan / pelepasan / perpindahan
--    Tanpa FK ke olt_onus: sync inventori boleh menghapus baris ONU, riwayat
--    tetap harus utuh. Identitas ONU disalin sebagai teks (snapshot).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onu_assignment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  onu_id BIGINT UNSIGNED NOT NULL,
  onu_label VARCHAR(190) NOT NULL,
  action ENUM('assign', 'release', 'move') NOT NULL,
  from_customer_id INT NULL,
  to_customer_id INT NULL,
  actor_id INT NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_onu_history_onu (onu_id, created_at),
  KEY idx_onu_history_customer (to_customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig029_gate;

DELIMITER //
CREATE PROCEDURE _mig029_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_idx INT DEFAULT 0;
  DECLARE v_fk INT DEFAULT 0;
  DECLARE v_hist INT DEFAULT 0;
  DECLARE v_dup INT DEFAULT 0;

  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND column_name = 'customer_id';
  IF v_col = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '029: olt_onus.customer_id belum ada';
  END IF;

  SELECT COUNT(*) INTO v_idx FROM information_schema.STATISTICS
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus' AND index_name = 'uq_onus_customer';
  IF v_idx = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '029: unique uq_onus_customer belum ada';
  END IF;

  SELECT COUNT(*) INTO v_fk FROM information_schema.TABLE_CONSTRAINTS
   WHERE table_schema = DATABASE() AND table_name = 'olt_onus'
     AND constraint_name = 'fk_olt_onus_customer';
  IF v_fk = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '029: foreign key fk_olt_onus_customer belum ada';
  END IF;

  SELECT COUNT(*) INTO v_hist FROM information_schema.TABLES
   WHERE table_schema = DATABASE() AND table_name = 'onu_assignment_history';
  IF v_hist = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '029: tabel onu_assignment_history belum ada';
  END IF;

  SELECT COUNT(*) INTO v_dup FROM (
    SELECT customer_id FROM olt_onus WHERE customer_id IS NOT NULL
     GROUP BY customer_id HAVING COUNT(*) > 1
  ) d;
  IF v_dup > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '029: ada pelanggan dengan lebih dari satu ONU';
  END IF;
END//
DELIMITER ;

CALL _mig029_gate();
DROP PROCEDURE _mig029_gate;

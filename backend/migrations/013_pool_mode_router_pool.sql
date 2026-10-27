-- 013_pool_mode_router_pool.sql
-- Memisahkan dua arti yang sebelumnya bertumpuk pada `group-pool`:
--
--   group-pool  = GROUP ONLY (Hotspot Only)
--                 Khusus hotspot. RADIUS memakai profil hotspot bawaan router:
--                 tidak ada IP pool dibuat, tidak ada profil user hotspot dibuat.
--                 Karena itu rentang pool TIDAK wajib.
--
--   router-pool = IP pool MikroTik (per router)
--                 Khusus PPP. Panel membuat /ip/pool + profil PPP dengan
--                 local-address (gateway sesi) di luar rentang pool.
--
-- Baris lama bertipe PPP yang memakai group-pool berarti "panel membuat pool",
-- jadi dipindahkan ke router-pool supaya perilakunya tidak berubah.
--
-- Sifat: additive + idempoten.

SET @has_router_pool := (SELECT COUNT(*) FROM information_schema.COLUMNS
                          WHERE table_schema = DATABASE()
                            AND table_name   = 'group_profiles'
                            AND column_name  = 'pool_mode'
                            AND column_type LIKE '%router-pool%');

SET @sql := IF(@has_router_pool = 0,
  "ALTER TABLE group_profiles MODIFY pool_mode ENUM('mikrotik-pool','sql-ippool','group-pool','router-pool') NOT NULL DEFAULT 'mikrotik-pool'",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Pindahkan grup PPP lama: group-pool (yang dulu berarti "buat pool") -> router-pool.
UPDATE group_profiles
   SET pool_mode = 'router-pool'
 WHERE pool_mode = 'group-pool'
   AND type = 'ppp';

-- Grup hotspot yang terlanjur memakai group-pool dengan rentang pool: rentangnya
-- dibuang karena mode ini tidak membuat pool lagi.
UPDATE group_profiles
   SET pool_range_start = NULL,
       pool_range_end   = NULL,
       pool_local_address = NULL,
       mikrotik_pool_name = NULL,
       pool_created     = 0
 WHERE pool_mode = 'group-pool'
   AND type = 'hotspot';

-- ---------------------------------------------------------------------------
-- Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig013_gate;

DELIMITER //
CREATE PROCEDURE _mig013_gate()
BEGIN
  DECLARE v_mode VARCHAR(255) DEFAULT '';
  DECLARE v_bad INT DEFAULT 0;

  SELECT column_type INTO v_mode FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'group_profiles' AND column_name = 'pool_mode';
  IF v_mode NOT LIKE '%router-pool%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '013: pool_mode belum memuat router-pool';
  END IF;

  -- Tidak boleh ada lagi PPP yang memakai group-pool (mode itu khusus hotspot).
  SELECT COUNT(*) INTO v_bad FROM group_profiles
   WHERE pool_mode = 'group-pool' AND type <> 'hotspot';
  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '013: masih ada grup non-hotspot memakai group-pool';
  END IF;
END//
DELIMITER ;

CALL _mig013_gate();
DROP PROCEDURE _mig013_gate;

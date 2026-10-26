-- ============================================================================
-- 006_service_profiles.sql
-- Bandwidth, Group Profile, Profile Hotspot/PPP, dan voucher untuk panel
-- Jawara ISP (MariaDB 10.11+).
--
-- STATUS: belum dijalankan. Jalankan setelah disetujui dan backup dibuat.
--
-- Membuat 6 tabel baru:
--   bandwidth_profiles  batas kecepatan (dipakai bersama MikroTik + RADIUS)
--   group_profiles      grup RADIUS + profil router (satu grup satu router)
--   hotspot_profiles    paket jual untuk hotspot
--   ppp_profiles        paket jual untuk PPP
--   radius_vouchers     akun/voucher yang dibuat dari profil
--   radippool           pool IP untuk modul sqlippool FreeRADIUS
--
-- Sifat migrasi:
--   * TIDAK mengubah/menghapus baris di tabel lama.
--   * Tabel `packages` TIDAK dihapus di sini; penghapusan dilakukan terpisah
--     setelah halaman Paket Internet dialihkan (butuh persetujuan).
--   * Rollback = DROP TABLE pada 6 tabel di atas. Data voucher ikut hilang.
--
-- Contoh (JANGAN dijalankan otomatis oleh panel):
--   mariadb isp_billing < 006_service_profiles.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bandwidth: satu definisi kecepatan, dipakai profil hotspot & PPP.
--    Nilai disimpan dalam Kbps agar bebas pembulatan (1 Mbps = 1000 Kbps).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bandwidth_profiles (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  owner_id                    INT NOT NULL,
  name                        VARCHAR(64) NOT NULL,
  min_upload_kbps             INT NOT NULL DEFAULT 0,
  min_download_kbps           INT NOT NULL DEFAULT 0,
  max_upload_kbps             INT NOT NULL,
  max_download_kbps           INT NOT NULL,
  burst_enabled               TINYINT(1) NOT NULL DEFAULT 0,
  burst_upload_kbps           INT NULL,
  burst_download_kbps         INT NULL,
  burst_threshold_upload_kbps INT NULL,
  burst_threshold_download_kbps INT NULL,
  burst_time_sec              INT NULL,
  priority                    TINYINT NOT NULL DEFAULT 1,
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bw_owner_name (owner_id, name),
  KEY idx_bw_owner (owner_id),
  CONSTRAINT fk_bw_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_bw_max CHECK (max_upload_kbps > 0 AND max_download_kbps > 0),
  CONSTRAINT ck_bw_min CHECK (min_upload_kbps >= 0 AND min_download_kbps >= 0),
  CONSTRAINT ck_bw_priority CHECK (priority BETWEEN 1 AND 8)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 2. Group Profile: satu grup = satu router.
--    Nama grup dipakai sebagai nama profil di MikroTik dan nama grup RADIUS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_profiles (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  owner_id           INT NOT NULL,
  router_id          INT NOT NULL,
  name               VARCHAR(64) NOT NULL,
  type               ENUM('hotspot','ppp') NOT NULL,
  pool_mode          ENUM('mikrotik-pool','sql-ippool') NOT NULL DEFAULT 'mikrotik-pool',
  mikrotik_pool_name VARCHAR(64) NULL,
  dns_primary        VARCHAR(45) NULL,
  dns_secondary      VARCHAR(45) NULL,
  parent_queue       VARCHAR(64) NULL,
  -- 1 = pakai profil bawaan router, panel tidak membuat profil baru.
  use_router_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_owner_type_name (owner_id, type, name),
  KEY idx_group_router (router_id),
  CONSTRAINT fk_group_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_group_router FOREIGN KEY (router_id) REFERENCES mikrotik_devices(id) ON DELETE RESTRICT,
  CONSTRAINT ck_group_pool CHECK (
    pool_mode <> 'mikrotik-pool' OR mikrotik_pool_name IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 3. Profile Hotspot
--    limited  : timebase (batas online) + quotabase (batas pemakaian)
--    unlimited: keduanya NULL
--    validity : masa aktif sejak LOGIN PERTAMA; 0 = tanpa batas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotspot_profiles (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  owner_id         INT NOT NULL,
  group_profile_id INT NOT NULL,
  bandwidth_id     INT NOT NULL,
  name             VARCHAR(64) NOT NULL,
  cost_price       DECIMAL(12,2) NOT NULL,
  sell_price       DECIMAL(12,2) NOT NULL,
  promo_price      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_percent      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  quota_type       ENUM('unlimited','limited') NOT NULL DEFAULT 'unlimited',
  timebase_value   INT NULL,
  timebase_unit    ENUM('minute','hour','day','month') NULL,
  quotabase_value  INT NULL,
  quotabase_unit   ENUM('MB','GB') NULL,
  validity_value   INT NOT NULL DEFAULT 0,
  validity_unit    ENUM('minute','hour','day','month') NOT NULL DEFAULT 'day',
  shared_users     TINYINT NOT NULL DEFAULT 1,
  priority         TINYINT NOT NULL DEFAULT 1,
  login_days       SET('mon','tue','wed','thu','fri','sat','sun') NULL,
  login_start      TIME NULL,
  login_end        TIME NULL,
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hs_owner_name (owner_id, name),
  KEY idx_hs_group (group_profile_id),
  KEY idx_hs_bandwidth (bandwidth_id),
  CONSTRAINT fk_hs_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_hs_group FOREIGN KEY (group_profile_id) REFERENCES group_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_hs_bandwidth FOREIGN KEY (bandwidth_id) REFERENCES bandwidth_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT ck_hs_price CHECK (cost_price >= 0 AND sell_price >= 0 AND promo_price >= 0),
  CONSTRAINT ck_hs_tax CHECK (tax_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_hs_priority CHECK (priority BETWEEN 1 AND 8),
  CONSTRAINT ck_hs_shared CHECK (shared_users >= 1),
  -- limited wajib punya minimal satu batas; unlimited tidak boleh punya batas.
  CONSTRAINT ck_hs_limit CHECK (
    (quota_type = 'unlimited' AND timebase_value IS NULL AND quotabase_value IS NULL)
    OR (quota_type = 'limited' AND (timebase_value IS NOT NULL OR quotabase_value IS NOT NULL))
  ),
  CONSTRAINT ck_hs_login_hours CHECK (
    (login_start IS NULL AND login_end IS NULL)
    OR (login_start IS NOT NULL AND login_end IS NOT NULL AND login_start <> login_end)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 4. Profile PPP
--    Tidak ada quota base. shared_users > 1 ditolak aplikasi bila grup
--    memakai sql-ippool (satu IP tidak bisa dipakai beberapa sesi sekaligus).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ppp_profiles (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  owner_id         INT NOT NULL,
  group_profile_id INT NOT NULL,
  bandwidth_id     INT NOT NULL,
  name             VARCHAR(64) NOT NULL,
  cost_price       DECIMAL(12,2) NOT NULL,
  sell_price       DECIMAL(12,2) NOT NULL,
  promo_price      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_percent      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  validity_value   INT NOT NULL DEFAULT 0,
  validity_unit    ENUM('minute','hour','day','month') NOT NULL DEFAULT 'day',
  shared_users     TINYINT NOT NULL DEFAULT 1,
  priority         TINYINT NOT NULL DEFAULT 1,
  login_days       SET('mon','tue','wed','thu','fri','sat','sun') NULL,
  login_start      TIME NULL,
  login_end        TIME NULL,
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ppp_owner_name (owner_id, name),
  KEY idx_ppp_group (group_profile_id),
  KEY idx_ppp_bandwidth (bandwidth_id),
  CONSTRAINT fk_ppp_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppp_group FOREIGN KEY (group_profile_id) REFERENCES group_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ppp_bandwidth FOREIGN KEY (bandwidth_id) REFERENCES bandwidth_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ppp_price CHECK (cost_price >= 0 AND sell_price >= 0 AND promo_price >= 0),
  CONSTRAINT ck_ppp_tax CHECK (tax_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_ppp_priority CHECK (priority BETWEEN 1 AND 8),
  CONSTRAINT ck_ppp_shared CHECK (shared_users >= 1),
  CONSTRAINT ck_ppp_login_hours CHECK (
    (login_start IS NULL AND login_end IS NULL)
    OR (login_start IS NOT NULL AND login_end IS NOT NULL AND login_start <> login_end)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 5. Voucher / akun. Satu baris = satu akun yang bisa dipakai pelanggan.
--    Status:
--      new-created  dibuat, belum diserahkan
--      ready-to-use sudah diserahkan, belum pernah login
--      active       sudah login, masa aktif berjalan
--      expired      masa aktif / kuota habis
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius_vouchers (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  profile_type      ENUM('hotspot','ppp') NOT NULL,
  profile_id        INT NOT NULL,
  group_profile_id  INT NOT NULL,
  profile_name      VARCHAR(64) NOT NULL,
  username          VARCHAR(64) NOT NULL,
  password          VARCHAR(64) NOT NULL,
  customer_id       INT NULL,
  status            ENUM('new-created','ready-to-use','active','expired') NOT NULL DEFAULT 'new-created',
  price             DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  first_login_at    DATETIME NULL,
  expires_at        DATETIME NULL,
  online_seconds    BIGINT NOT NULL DEFAULT 0,
  quota_used_bytes  BIGINT NOT NULL DEFAULT 0,
  created_by        INT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_voucher_username (username),
  KEY idx_voucher_profile (profile_type, profile_id),
  KEY idx_voucher_status (status),
  KEY idx_voucher_customer (customer_id),
  CONSTRAINT fk_voucher_profile_group FOREIGN KEY (group_profile_id) REFERENCES group_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_voucher_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 6. radippool — dipakai modul sqlippool FreeRADIUS (pool IP global).
--    Struktur mengikuti skema resmi FreeRADIUS 3.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radippool (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  pool_name        VARCHAR(30) NOT NULL,
  framedipaddress  VARCHAR(45) NOT NULL DEFAULT '',
  nasipaddress     VARCHAR(45) NOT NULL DEFAULT '',
  pool_key         VARCHAR(30) NOT NULL,
  callingstationid VARCHAR(50) NOT NULL DEFAULT '',
  username         VARCHAR(64) NOT NULL DEFAULT '',
  expiry_time      DATETIME NULL,
  acctsessionid    VARCHAR(64) NOT NULL DEFAULT '',
  acctuniqueid     VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uq_radippool_addr (pool_name, framedipaddress),
  KEY idx_radippool_pool_key (pool_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Verifikasi: pastikan 6 tabel benar-benar ada sebelum migrasi dinyatakan ok.
-- ---------------------------------------------------------------------------
DELIMITER $$

CREATE PROCEDURE _mig006_verify()
BEGIN
  DECLARE v_tables INT DEFAULT 0;

  SELECT COUNT(*) INTO v_tables
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('bandwidth_profiles','group_profiles','hotspot_profiles',
                        'ppp_profiles','radius_vouchers','radippool');

  IF v_tables <> 6 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Verifikasi 006 gagal: tidak semua tabel terbentuk.';
  END IF;
END$$

CALL _mig006_verify()$$
DROP PROCEDURE _mig006_verify$$

DELIMITER ;

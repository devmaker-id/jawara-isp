-- 022_olt.sql
-- Manajemen OLT (GPON/EPON) — baca-saja.
--
-- Panel ini hanya MEMBACA inventori ONU dari perangkat lewat SSH/telnet.
-- Tidak ada tabel atau endpoint yang menulis konfigurasi OLT: tidak ada
-- `onu add`, `no onu`, `save`, `reboot`. Kolom `read_only` disimpan dan
-- dipaksa `1` di service, supaya niat itu terlihat di skema, bukan hanya di
-- komentar kode.
--
-- Tiga tabel:
--   olt_devices    perangkat + kredensial (terenkripsi, pola sama seperti
--                  mikrotik_devices) + status koneksi terakhir
--   olt_onus       inventori ONU hasil pembacaan terakhir
--   olt_sync_runs  riwayat pembacaan (untuk tahu kapan terakhir jalan & hasilnya)
--
-- Sifat: additive + idempoten (aman dijalankan ulang).

-- ---------------------------------------------------------------------------
-- 1. Perangkat OLT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_devices (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(80)  NOT NULL,
  -- Driver menentukan cara sesi & parser. Vendor bebas di perangkat, tapi
  -- hanya nilai yang punya driver terdaftar yang bisa dipakai sync.
  vendor            VARCHAR(40)  NOT NULL DEFAULT 'vsol',
  transport         ENUM('ssh','telnet') NOT NULL DEFAULT 'ssh',
  host              VARCHAR(120) NOT NULL,
  port              INT          NOT NULL DEFAULT 22,
  username          VARCHAR(80)  NOT NULL,
  -- AES-256-GCM, prefix "v1:" (lihat src/app/modules/olt/olt-crypto.ts).
  password_enc      TEXT         NOT NULL,
  enable_password_enc TEXT       NULL,
  -- Port PON yang dibaca, dipisah koma. Satu PON pun tetap ditulis "0/1",
  -- supaya jelas mana yang dibaca — bukan "semua yang ada".
  pon_ports         VARCHAR(120) NOT NULL DEFAULT '0/1',
  -- Pola prompt perangkat (opsional). Kosong = pakai pola bawaan driver.
  prompt_pattern    VARCHAR(191) NULL,
  -- Selalu 1 untuk sekarang. Kolom disimpan agar niat baca-saja bisa diaudit.
  read_only         TINYINT(1)   NOT NULL DEFAULT 1,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_checked_at   DATETIME     NULL,
  last_connected    TINYINT(1)   NULL,
  last_message      VARCHAR(255) NULL,
  last_identity     VARCHAR(120) NULL,
  last_version      VARCHAR(80)  NULL,
  created_by        INT          NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_olt_devices_host (host, port),
  KEY idx_olt_devices_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Inventori ONU
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_onus (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  olt_id          INT          NOT NULL,
  port_id         VARCHAR(20)  NOT NULL,
  onu_id          VARCHAR(20)  NOT NULL,
  serial_number   VARCHAR(40)  NULL,
  onu_name        VARCHAR(120) NULL,
  description     VARCHAR(191) NULL,
  admin_state     VARCHAR(20)  NULL,
  omcc_state      VARCHAR(20)  NULL,
  phase_state     VARCHAR(30)  NULL,
  online          TINYINT(1)   NOT NULL DEFAULT 0,
  -- Redaman disimpan sebagai angka asli (bukan teks) supaya bisa diurutkan
  -- dan difilter "di bawah -27 dBm".
  rx_power_onu    DECIMAL(6,2) NULL,
  rx_power_olt    DECIMAL(6,2) NULL,
  tx_power        DECIMAL(6,2) NULL,
  temperature     DECIMAL(6,2) NULL,
  voltage         DECIMAL(6,2) NULL,
  tx_bias         DECIMAL(7,3) NULL,
  last_seen_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_olt_onus (olt_id, port_id, onu_id),
  KEY idx_olt_onus_online (olt_id, online),
  KEY idx_olt_onus_rx (olt_id, rx_power_onu),
  CONSTRAINT fk_olt_onus_device FOREIGN KEY (olt_id) REFERENCES olt_devices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Riwayat pembacaan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_sync_runs (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  olt_id        INT          NOT NULL,
  status        ENUM('running','ok','error') NOT NULL DEFAULT 'running',
  onu_total     INT          NOT NULL DEFAULT 0,
  onu_online    INT          NOT NULL DEFAULT 0,
  message       VARCHAR(255) NULL,
  started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  user_id       INT          NULL,
  KEY idx_olt_sync_olt (olt_id, started_at),
  CONSTRAINT fk_olt_sync_device FOREIGN KEY (olt_id) REFERENCES olt_devices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Izin panel
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, label, module, sort) VALUES
  ('olt.view',   'Lihat OLT & ONU',   'olt', 10),
  ('olt.create', 'Tambah perangkat OLT', 'olt', 20),
  ('olt.update', 'Ubah perangkat OLT',   'olt', 30),
  ('olt.delete', 'Hapus perangkat OLT',  'olt', 40),
  ('olt.sync',   'Baca inventori (sync)','olt', 50)
ON DUPLICATE KEY UPDATE label = VALUES(label), module = VALUES(module), sort = VALUES(sort);

-- Hanya kode modul olt yang disentuh: penyesuaian izin lain yang sudah dibuat
-- admin tidak boleh tertimpa oleh migrasi ini.
INSERT INTO role_permissions (role, code, allowed)
SELECT 'admin', code, 1 FROM permissions WHERE module = 'olt'
ON DUPLICATE KEY UPDATE allowed = allowed;

-- Operator: penuh kecuali hapus perangkat (menghapus perangkat ikut menghapus
-- inventori ONU-nya, jadi itu tetap milik admin).
INSERT INTO role_permissions (role, code, allowed)
SELECT 'operator', code, IF(code = 'olt.delete', 0, 1) FROM permissions WHERE module = 'olt'
ON DUPLICATE KEY UPDATE allowed = allowed;

-- Reseller: hanya boleh melihat.
INSERT INTO role_permissions (role, code, allowed)
SELECT 'resseler', code, IF(code = 'olt.view', 1, 0) FROM permissions WHERE module = 'olt'
ON DUPLICATE KEY UPDATE allowed = allowed;
-- 037_olt_syslog.sql
-- Fitur Syslog Client OLT: kolektor event + riwayat aksi konfigurasi.
--
-- Dua tabel baru:
--   olt_syslog_events   event syslog yang diterima dari OLT (UDP/514)
--   olt_syslog_actions  riwayat apply/rollback/read konfigurasi syslog (audit)
--
-- Izin baru:
--   olt.syslog.read   (operator)  — baca status syslog perangkat
--   olt.syslog.write  (admin)     — ubah konfigurasi syslog perangkat
--
-- Tidak ada kolom baru di olt_devices: status syslog selalu dibaca kembali dari
-- perangkat (sumber kebenaran), dan nilai yang "diminta" tersimpan sebagai
-- before/after JSON di olt_syslog_actions.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. Event syslog yang diterima
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_syslog_events (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  olt_id        INT           NULL,
  olt_name      VARCHAR(80)   NULL,
  source_ip     VARCHAR(45)   NOT NULL,
  event_type    VARCHAR(30)   NOT NULL,
  port_id       VARCHAR(20)   NULL,
  onu_id        VARCHAR(20)   NULL,
  onu_mac       VARCHAR(20)   NULL,
  onu_name      VARCHAR(120)  NULL,
  raw_log       TEXT          NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_olt_syslog_created (created_at),
  KEY idx_olt_syslog_olt (olt_id),
  KEY idx_olt_syslog_type (event_type),
  CONSTRAINT fk_olt_syslog_device FOREIGN KEY (olt_id) REFERENCES olt_devices (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Riwayat aksi konfigurasi syslog (audit + rollback)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS olt_syslog_actions (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  olt_id         INT          NOT NULL,
  action         VARCHAR(20)  NOT NULL,   -- apply | rollback | read
  before_state   JSON         NULL,        -- snapshot sebelum perubahan
  after_state    JSON         NULL,        -- snapshot sesudah (read-back)
  message        VARCHAR(255) NULL,
  user_id        INT          NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_olt_syslog_action_olt (olt_id, id),
  CONSTRAINT fk_olt_syslog_action_device FOREIGN KEY (olt_id) REFERENCES olt_devices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Izin
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, label, module, sort) VALUES
  ('olt.syslog.read',  'Baca status Syslog OLT',  'olt', 60),
  ('olt.syslog.write', 'Ubah konfigurasi Syslog OLT', 'olt', 70)
ON DUPLICATE KEY UPDATE label = VALUES(label), module = VALUES(module), sort = VALUES(sort);

-- Admin: keduanya.
INSERT INTO role_permissions (role, code, allowed)
SELECT 'admin', code, 1 FROM permissions WHERE code IN ('olt.syslog.read', 'olt.syslog.write')
ON DUPLICATE KEY UPDATE allowed = allowed;

-- Operator: baca saja (ubah tetap milik admin, konsisten dengan olt.delete).
INSERT INTO role_permissions (role, code, allowed)
SELECT 'operator', code, IF(code = 'olt.syslog.write', 0, 1)
  FROM permissions WHERE code IN ('olt.syslog.read', 'olt.syslog.write')
ON DUPLICATE KEY UPDATE allowed = allowed;

-- Reseller: tidak ada akses (modul OLT tertutup untuk reseller, lihat 025).
INSERT INTO role_permissions (role, code, allowed)
SELECT 'resseler', code, 0 FROM permissions WHERE code IN ('olt.syslog.read', 'olt.syslog.write')
ON DUPLICATE KEY UPDATE allowed = allowed;
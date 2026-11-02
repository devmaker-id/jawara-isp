-- 030_wa_gateway.sql
-- WhatsApp Gateway milik Jawara-ISP: koneksi, kebijakan akses, riwayat pesan,
-- dan catatan kejadian. Additive: tidak menyentuh tabel pelanggan/RADIUS/OLT.
--
-- Keputusan penting:
--   * Sesi WhatsApp TIDAK disimpan di database (kredensial Baileys di disk,
--     mode 0700). Database hanya menyimpan status & jejak, supaya dump DB tidak
--     bisa dipakai membajak sesi.
--   * `wa_messages.wa_id` UNIQUE = penjaga duplikasi. Satu pesan WhatsApp hanya
--     diproses sekali walau worker mengirim ulang.
--   * Isi pesan disimpan terpotong (200 karakter) — cukup untuk audit, bukan
--     arsip percakapan penuh.

CREATE TABLE IF NOT EXISTS wa_settings (
  setting_key VARCHAR(64) NOT NULL,
  setting_value VARCHAR(500) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_allowlist (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('number', 'group') NOT NULL,
  value VARCHAR(64) NOT NULL,
  label VARCHAR(100) NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_allowlist (kind, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wa_id VARCHAR(120) NOT NULL,
  direction ENUM('in', 'out') NOT NULL,
  chat_id VARCHAR(64) NOT NULL,
  chat_type ENUM('dm', 'group') NOT NULL,
  sender VARCHAR(64) NULL,
  body_preview VARCHAR(200) NULL,
  processing ENUM('direct', 'ai', 'ignored', 'denied', 'error') NOT NULL,
  command VARCHAR(40) NULL,
  reply_status ENUM('sent', 'failed', 'skipped') NOT NULL DEFAULT 'skipped',
  error_note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_messages_wa_id (wa_id),
  KEY idx_wa_messages_created (created_at),
  KEY idx_wa_messages_processing (processing, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind VARCHAR(40) NOT NULL,
  message VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_wa_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_ai_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chat_id VARCHAR(64) NOT NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(80) NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  ok TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_wa_ai_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kebijakan awal = salinan kebijakan WhatsApp yang berlaku sekarang.
INSERT INTO wa_settings (setting_key, setting_value) VALUES
  ('dm_policy', 'allowlist'),
  ('group_policy', 'allowlist'),
  ('require_mention', '1'),
  ('ai_enabled', '0'),
  ('ai_command_prefix_only', '0'),
  ('gateway_enabled', '1')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

-- 018_isolir_total_limit.sql
-- Dua hal yang saling terkait:
--
-- 1. Limitasi dibaca sebagai TOTAL kumulatif (dijumlah dari radacct), bukan per
--    sesi. Untuk itu penegak butuh mencatat MENGAPA sebuah akun diblokir, supaya
--    pesan yang tampil di halaman login hotspot tepat (waktu habis vs user
--    expired vs kuota habis) dan supaya isolir tidak dikirim berulang.
--
-- 2. Profil ISOLIR untuk PPPoE: pelanggan yang kehabisan batas atau menunggak
--    dipindahkan grup RADIUS-nya ke ISOLIR, sehingga ia mendapat IP dari
--    10.127.0.0/18 dan hanya bisa membuka halaman isolir.
--
-- Konfigurasi isolir disimpan di tabel `config` (key/value) agar bisa diubah
-- dari panel tanpa deploy.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. Alasan blokir + jejak isolir per akun
-- ---------------------------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND column_name = 'block_reason') = 0,
  "ALTER TABLE radius_vouchers ADD COLUMN block_reason VARCHAR(16) NULL AFTER status",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
                   AND column_name = 'isolir_at') = 0,
  "ALTER TABLE radius_vouchers ADD COLUMN isolir_at DATETIME NULL AFTER block_reason",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Konfigurasi isolir
--    10.127.0.0/18 = 10.127.0.0 - 10.127.63.255.
--    Gateway .1, pool mulai .2 supaya alamat gateway tidak ikut dibagikan.
-- ---------------------------------------------------------------------------
INSERT INTO config (config_key, config_value) VALUES
  ('isolir_enabled',    '1'),
  ('isolir_group',      'ISOLIR'),
  ('isolir_pool_name',  'ISOLIR-POOL'),
  ('isolir_cidr',       '10.127.0.0/18'),
  ('isolir_gateway',    '10.127.0.1'),
  ('isolir_range_start','10.127.0.2'),
  ('isolir_range_end',  '10.127.63.254'),
  ('isolir_rate_limit', '512k/512k'),
  ('isolir_url',        ''),
  ('isolir_message',    'Tagihan belum dibayar atau masa aktif habis. Silakan buka halaman isolir untuk melanjutkan.')
ON DUPLICATE KEY UPDATE config_key = config_key;

-- ---------------------------------------------------------------------------
-- 3. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig018_gate;

DELIMITER //
CREATE PROCEDURE _mig018_gate()
BEGIN
  DECLARE v_col INT DEFAULT 0;
  DECLARE v_cfg INT DEFAULT 0;

  SELECT COUNT(*) INTO v_col FROM information_schema.COLUMNS
   WHERE table_schema = DATABASE() AND table_name = 'radius_vouchers'
     AND column_name IN ('block_reason','isolir_at');
  IF v_col <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '018: kolom block_reason/isolir_at belum lengkap';
  END IF;

  SELECT COUNT(*) INTO v_cfg FROM config WHERE config_key LIKE 'isolir_%';
  IF v_cfg < 10 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '018: konfigurasi isolir belum lengkap (harus 10 kunci)';
  END IF;
END//
DELIMITER ;

CALL _mig018_gate();
DROP PROCEDURE _mig018_gate;

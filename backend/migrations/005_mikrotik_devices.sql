-- ============================================================================
-- 005_mikrotik_devices.sql
-- Daftar perangkat MikroTik (multi-router) untuk panel Jawara ISP.
--
-- STATUS: belum dijalankan di produksi. Jalankan HANYA setelah disetujui dan
-- setelah backup database dibuat.
--
-- Latar belakang: sebelumnya kredensial API hanya satu set di tabel `config`
-- (mikrotik_host/port/user/password). Migrasi ini memindahkan konsep itu ke
-- tabel `mikrotik_devices` sehingga panel bisa menyimpan BANYAK router,
-- memilih router aktif, dan melakukan CRUD koneksi per perangkat.
--
-- Sifat migrasi:
--   * TIDAK mengubah atau menghapus baris di tabel panel mana pun
--     (customers/invoices/payments/users/audit_logs tetap utuh).
--   * Kunci `config.mikrotik_*` TIDAK dihapus: masih dipakai sebagai fallback
--     bila daftar perangkat kosong.
--   * Baris perangkat awal di-seed dari `config` (hanya bila ada host terisi),
--     sehingga panel langsung menampilkan router yang sudah dipakai sekarang.
--   * Password hasil seed masih teks biasa (ditulis SQL); panel akan
--     mengenkripsinya saat perangkat pertama kali disimpan ulang lewat UI.
--     Nilai terenkripsi berformat v1:<iv>:<tag>:<data> (AES-256-GCM).
--   * Idempoten dari sisi gate: run kedua ditolak dengan pesan jelas, bukan
--     menimpa data perangkat yang sudah diubah admin.
--
-- Rollback (manual):
--   mariadb isp_billing -e "DROP TABLE IF EXISTS mikrotik_devices;"
--   Data panel tidak terpengaruh; kredensial perangkat harus diisi ulang.
--
-- Contoh (JANGAN dijalankan otomatis oleh panel):
--   mariadb isp_billing < 005_mikrotik_devices.sql
-- ============================================================================

DELIMITER $$

CREATE PROCEDURE _mig005_gate(IN phase VARCHAR(8))
BEGIN
  DECLARE v_exists  INT DEFAULT 0;
  DECLARE v_missing INT DEFAULT 0;
  DECLARE v_cols    INT DEFAULT 0;
  DECLARE v_uniq    INT DEFAULT 0;
  DECLARE v_rows    INT DEFAULT 0;

  SELECT COUNT(*) INTO v_exists
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name = 'mikrotik_devices';

  IF phase = 'pre' THEN
    -- Fail-closed: jangan pernah menimpa daftar perangkat yang sudah dipakai.
    IF v_exists > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '005_mikrotik_devices.sql sudah diterapkan: tabel mikrotik_devices sudah ada. Migrasi dihentikan tanpa perubahan.';
    END IF;

    SELECT COUNT(*) INTO v_missing
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('config', 'audit_logs');
    IF v_missing < 2 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Prasyarat 005 tidak terpenuhi: tabel config/audit_logs belum ada. Jalankan skema dasar panel lebih dulu.';
    END IF;
  END IF;

  IF phase = 'post' THEN
    IF v_exists = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Verifikasi 005 gagal: tabel mikrotik_devices tidak terbentuk.';
    END IF;

    SELECT COUNT(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'mikrotik_devices'
       AND column_name IN ('id','name','host','api_port','api_user','api_password',
                           'gui_url','description','write_enabled','is_active',
                           'last_checked_at','last_connected','last_message',
                           'last_identity','created_at','updated_at');
    -- Harus sama dengan jumlah kolom di models/mikrotik-device.model.ts (16).
    -- Pakai <> supaya kolom yang hilang tidak lolos verifikasi.
    IF v_cols <> 16 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Verifikasi 005 gagal: kolom mikrotik_devices tidak lengkap.';
    END IF;

    SELECT COUNT(*) INTO v_uniq
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'mikrotik_devices'
       AND index_name = 'uq_mikrotik_devices_name'
       AND non_unique = 0;
    IF v_uniq = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Verifikasi 005 gagal: indeks unik uq_mikrotik_devices_name tidak ada.';
    END IF;

    SELECT COUNT(*) INTO v_rows FROM mikrotik_devices;
    IF v_rows = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Verifikasi 005 gagal: tabel mikrotik_devices kosong (seed dari config tidak berjalan).';
    END IF;
  END IF;
END$$

DELIMITER ;

CALL _mig005_gate('pre');

START TRANSACTION;

CREATE TABLE IF NOT EXISTS mikrotik_devices (
  id               INT           NOT NULL AUTO_INCREMENT,
  name             VARCHAR(64)   NOT NULL,
  host             VARCHAR(128)  NOT NULL,
  api_port         INT           NOT NULL DEFAULT 1998,
  api_user         VARCHAR(64)   NOT NULL,
  -- Teks biasa hanya untuk hasil seed; panel menulis ulang dalam format
  -- terenkripsi v1:<iv>:<tag>:<data> saat perangkat disimpan lewat UI.
  api_password     VARCHAR(255)  NOT NULL DEFAULT '',
  gui_url          VARCHAR(255)  DEFAULT NULL,
  description      VARCHAR(200)  DEFAULT NULL,
  write_enabled    TINYINT(1)    NOT NULL DEFAULT 0,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  last_checked_at  DATETIME      DEFAULT NULL,
  last_connected   TINYINT(1)    DEFAULT NULL,
  last_message     VARCHAR(255)  DEFAULT NULL,
  last_identity    VARCHAR(64)   DEFAULT NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mikrotik_devices_name (name),
  KEY idx_mikrotik_devices_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed perangkat awal dari konfigurasi lama (bila host sudah pernah diisi).
INSERT INTO mikrotik_devices
  (name, host, api_port, api_user, api_password, gui_url, description, write_enabled, is_active)
SELECT
  'MikroTik Utama',
  TRIM(c_host.config_value),
  CAST(COALESCE(NULLIF(TRIM(c_port.config_value), ''), '1998') AS UNSIGNED),
  TRIM(COALESCE(c_user.config_value, '')),
  COALESCE(c_pass.config_value, ''),
  NULLIF(TRIM(COALESCE(c_gui.config_value, '')), ''),
  'Seed dari konfigurasi tunggal (Pengaturan → Integrasi)',
  CASE WHEN LOWER(TRIM(COALESCE(c_write.config_value, '0'))) IN ('1','true','yes') THEN 1 ELSE 0 END,
  1
FROM (SELECT 1 AS seed) AS s
LEFT JOIN config AS c_host  ON c_host.config_key  = 'mikrotik_host'
LEFT JOIN config AS c_port  ON c_port.config_key  = 'mikrotik_port'
LEFT JOIN config AS c_user  ON c_user.config_key  = 'mikrotik_user'
LEFT JOIN config AS c_pass  ON c_pass.config_key  = 'mikrotik_password'
LEFT JOIN config AS c_gui   ON c_gui.config_key   = 'mikrotik_gui_url'
LEFT JOIN config AS c_write ON c_write.config_key = 'mikrotik_write_enabled'
WHERE TRIM(COALESCE(c_host.config_value, '')) <> ''
  AND TRIM(COALESCE(c_user.config_value, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM mikrotik_devices);

COMMIT;

CALL _mig005_gate('post');

DROP PROCEDURE IF EXISTS _mig005_gate;

-- ============================================================================
-- Catatan lanjutan:
--   * Setelah migrasi, buka panel → MikroTik → Perangkat & Koneksi, uji
--     koneksi tiap perangkat, lalu simpan ulang password agar tersimpan
--     terenkripsi (AES-256-GCM, kunci dari SECRET_KEY aplikasi).
--   * SECRET_KEY yang berubah membuat password tersimpan tidak bisa dibaca;
--     isi ulang password perangkat bila itu terjadi.
-- ============================================================================
-- 019_permissions.sql
-- Hak akses per akun, dikelola lewat checkbox di /pengguna.
--
-- Tiga tabel, satu aturan:
--   permissions       katalog izin (kode + label + modul)
--   role_permissions  nilai awal per role
--   user_permissions  penimpaan per akun (menang atas role)
--
-- Efektif = user_permissions kalau ada barisnya, kalau tidak role_permissions.
-- Admin tidak dibatasi sama sekali (bypass di guard), sesuai keputusan pemilik.
--
-- Ditambah satu tabel alur persetujuan: reseller boleh mengubah tapi TIDAK
-- boleh menghapus. Permintaan hapusnya masuk antrean untuk operator/admin.
--
-- Sifat: additive + idempoten.

-- ---------------------------------------------------------------------------
-- 1. Katalog izin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  code    VARCHAR(48) NOT NULL,
  label   VARCHAR(80) NOT NULL,
  module  VARCHAR(24) NOT NULL,
  sort    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code),
  KEY idx_permissions_module (module, sort)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Nilai awal per role
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role    ENUM('admin','operator','resseler') NOT NULL,
  code    VARCHAR(48) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (role, code),
  CONSTRAINT fk_roleperm_code FOREIGN KEY (code) REFERENCES permissions (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Penimpaan per akun
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT NOT NULL,
  code    VARCHAR(48) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, code),
  CONSTRAINT fk_userperm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_userperm_code FOREIGN KEY (code) REFERENCES permissions (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Antrean persetujuan (hapus oleh reseller)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_requests (
  id           INT NOT NULL AUTO_INCREMENT,
  requested_by INT NOT NULL,
  action       VARCHAR(48) NOT NULL,
  target_type  VARCHAR(32) NOT NULL,
  target_id    INT NOT NULL,
  summary      VARCHAR(255) NOT NULL DEFAULT '',
  payload      TEXT NULL,
  status       ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  decided_by   INT NULL,
  decided_at   DATETIME NULL,
  note         VARCHAR(255) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_approval_status (status, created_at),
  KEY idx_approval_requester (requested_by),
  CONSTRAINT fk_approval_requester FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_approval_decider FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Isi katalog
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, label, module, sort) VALUES
  ('customer.view',        'Lihat pelanggan',            'customer', 10),
  ('customer.create',      'Tambah pelanggan',           'customer', 20),
  ('customer.update',      'Ubah pelanggan',             'customer', 30),
  ('customer.delete',      'Hapus pelanggan',            'customer', 40),
  ('customer.assign_owner','Pindahkan pemilik',          'customer', 50),
  ('profile.view',         'Lihat profil layanan',       'profile',  10),
  ('profile.create',       'Tambah profil layanan',      'profile',  20),
  ('profile.update',       'Ubah profil layanan',        'profile',  30),
  ('profile.delete',       'Hapus profil layanan',       'profile',  40),
  ('group.view',           'Lihat group profile',        'group',    10),
  ('group.create',         'Tambah group profile',       'group',    20),
  ('group.update',         'Ubah group profile',         'group',    30),
  ('group.delete',         'Hapus group profile',        'group',    40),
  ('bandwidth.view',       'Lihat bandwidth',            'bandwidth',10),
  ('bandwidth.create',     'Tambah bandwidth',           'bandwidth',20),
  ('bandwidth.update',     'Ubah bandwidth',             'bandwidth',30),
  ('bandwidth.delete',     'Hapus bandwidth',            'bandwidth',40),
  ('voucher.view',         'Lihat voucher',              'voucher',  10),
  ('voucher.generate',     'Buat voucher',               'voucher',  20),
  ('voucher.print',        'Cetak voucher',              'voucher',  30),
  ('voucher.delete',       'Hapus voucher',              'voucher',  40),
  ('nas.view',             'Lihat NAS',                  'nas',      10),
  ('nas.create',           'Tambah NAS',                 'nas',      20),
  ('nas.update',           'Ubah NAS',                   'nas',      30),
  ('nas.delete',           'Hapus NAS',                  'nas',      40),
  ('device.view',          'Lihat perangkat MikroTik',   'device',   10),
  ('device.create',        'Tambah perangkat MikroTik',  'device',   20),
  ('device.update',        'Ubah perangkat MikroTik',    'device',   30),
  ('device.delete',        'Hapus perangkat MikroTik',   'device',   40),
  ('device.provision',     'Tulis konfigurasi perangkat','device',   50),
  ('radius.view',          'Lihat status FreeRADIUS',    'radius',   10),
  ('radius.config',        'Ubah/restart FreeRADIUS',    'radius',   20),
  ('isolir.view',          'Lihat profil isolir',        'isolir',   10),
  ('isolir.manage',        'Atur profil isolir',         'isolir',   20),
  ('invoice.view',         'Lihat tagihan',              'invoice',  10),
  ('invoice.create',       'Buat tagihan',               'invoice',  20),
  ('invoice.update',       'Ubah tagihan',               'invoice',  30),
  ('invoice.delete',       'Hapus tagihan',              'invoice',  40),
  ('invoice.pay',          'Catat pembayaran',           'invoice',  50),
  ('payment.view',         'Lihat pembayaran',           'payment',  10),
  ('payment.create',       'Tambah pembayaran',          'payment',  20),
  ('payment.void',         'Batalkan pembayaran',        'payment',  30),
  ('report.view',          'Lihat laporan',              'report',   10),
  ('tools.import',         'Impor database',             'tools',    10),
  ('tools.export',         'Ekspor database',            'tools',    20),
  ('user.view',            'Lihat akun pengguna',        'user',     10),
  ('user.create',          'Tambah akun pengguna',       'user',     20),
  ('user.update',          'Ubah akun pengguna',         'user',     30),
  ('user.delete',          'Hapus akun pengguna',        'user',     40),
  ('user.permissions',     'Atur hak akses akun',        'user',     50)
ON DUPLICATE KEY UPDATE label = VALUES(label), module = VALUES(module), sort = VALUES(sort);

-- ---------------------------------------------------------------------------
-- 6. Nilai awal role
--    admin    : semua (guard tetap bypass, isi ini hanya untuk tampilan)
--    operator : penuh di FreeRADIUS & MikroTik; DICEGAH membuat pelanggan
--    reseller : CRUD profil + voucher + ubah pelanggan; TIDAK boleh hapus
-- ---------------------------------------------------------------------------
DELETE FROM role_permissions;

-- admin: semua izin
INSERT INTO role_permissions (role, code, allowed)
SELECT 'admin', code, 1 FROM permissions;

-- operator: semua kecuali membuat pelanggan, memindah pemilik, mengatur hak akses
INSERT INTO role_permissions (role, code, allowed)
SELECT 'operator', code,
       CASE WHEN code IN ('customer.create', 'customer.assign_owner', 'user.permissions') THEN 0 ELSE 1 END
  FROM permissions;

-- reseller: hanya yang dibutuhkan; tanpa izin hapus apa pun
INSERT INTO role_permissions (role, code, allowed)
SELECT 'resseler', code,
       CASE WHEN code IN (
         'customer.view', 'customer.create', 'customer.update',
         'profile.view', 'profile.create', 'profile.update',
         'group.view', 'bandwidth.view',
         'voucher.view', 'voucher.generate', 'voucher.print',
         'invoice.view', 'payment.view', 'report.view'
       ) THEN 1 ELSE 0 END
  FROM permissions;

-- ---------------------------------------------------------------------------
-- 7. Gate
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig019_gate;

DELIMITER //
CREATE PROCEDURE _mig019_gate()
BEGIN
  DECLARE v_perm INT DEFAULT 0;
  DECLARE v_op INT DEFAULT 0;
  DECLARE v_rs INT DEFAULT 0;
  DECLARE v_bad INT DEFAULT 0;

  SELECT COUNT(*) INTO v_perm FROM permissions;
  IF v_perm < 45 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '019: katalog izin belum lengkap';
  END IF;

  -- Operator TIDAK boleh punya customer.create (keputusan pemilik).
  SELECT allowed INTO v_op FROM role_permissions WHERE role = 'operator' AND code = 'customer.create';
  IF v_op <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '019: operator tidak boleh membuat pelanggan';
  END IF;

  -- Reseller tidak boleh punya izin hapus apa pun.
  SELECT COUNT(*) INTO v_bad FROM role_permissions
   WHERE role = 'resseler' AND allowed = 1 AND code LIKE '%.delete';
  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '019: reseller tidak boleh punya izin hapus';
  END IF;

  SELECT COUNT(*) INTO v_rs FROM role_permissions WHERE role = 'resseler' AND allowed = 1;
  IF v_rs < 10 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '019: izin awal reseller belum terisi';
  END IF;
END//
DELIMITER ;

CALL _mig019_gate();
DROP PROCEDURE _mig019_gate;

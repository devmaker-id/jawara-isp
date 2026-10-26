-- ============================================================================
-- 004_freeradius_schema.sql
-- Skema FreeRADIUS 3.x untuk database panel Jawara ISP (MariaDB 10.11+).
--
-- STATUS: belum dijalankan di produksi. Jalankan HANYA setelah disetujui dan
-- setelah backup database dibuat.
--
-- Membuat 8 tabel: nas, radcheck, radreply, radgroupcheck, radgroupreply,
-- radusergroup, radacct, radpostauth.
--
-- Sifat migrasi:
--   * TIDAK menyentuh tabel panel (customers/invoices/payments/users/config).
--   * Gate 'pre' menolak eksekusi bila SEBAGIAN tabel sudah ada, supaya skema
--     parsial tidak pernah tercampur dengan versi ini.
--   * Gate 'post' memverifikasi semua tabel + kolom kunci benar-benar ada.
--   * Rollback = DROP TABLE pada 8 tabel rad*; TIDAK ada data panel yang
--     hilang, tetapi RIWAYAT AKUNTANSI RADIUS IKUT HILANG. Backup dulu.
--
-- Contoh (JANGAN dijalankan otomatis oleh panel):
--   mariadb isp_billing < 004_freeradius_schema.sql
-- ============================================================================

DELIMITER $$

CREATE PROCEDURE _mig004_gate(IN phase VARCHAR(8))
BEGIN
  DECLARE v_present INT DEFAULT 0;
  DECLARE v_missing INT DEFAULT 0;
  DECLARE v_expect  INT DEFAULT 8;
  DECLARE v_tmp INT DEFAULT 0;

  SELECT COUNT(*) INTO v_present
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('nas','radcheck','radreply','radgroupcheck',
                        'radgroupreply','radusergroup','radacct','radpostauth');

  IF phase = 'pre' THEN
    IF v_present > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MIG004: sebagian tabel rad* sudah ada; skema parsial ditolak. Periksa manual.';
    END IF;
  ELSEIF phase = 'post' THEN
    SET v_missing = v_expect - v_present;
    IF v_missing > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MIG004: tabel rad* tidak lengkap setelah migrasi.';
    END IF;

    -- Kolom kunci yang dipakai panel harus ada.
    SELECT COUNT(*) INTO v_tmp FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'radcheck'
       AND column_name = 'attribute';
    IF v_tmp = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MIG004: radcheck.attribute tidak ada.';
    END IF;

    SELECT COUNT(*) INTO v_tmp FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'radacct'
       AND column_name = 'acctstoptime';
    IF v_tmp = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MIG004: radacct.acctstoptime tidak ada.';
    END IF;

    SELECT COUNT(*) INTO v_tmp FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'nas'
       AND column_name = 'secret';
    IF v_tmp = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MIG004: nas.secret tidak ada.';
    END IF;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MIG004: phase tidak dikenal.';
  END IF;
END$$

DELIMITER ;

CALL _mig004_gate('pre');

-- nas: perangkat yang boleh mengirim permintaan RADIUS (MikroTik).
CREATE TABLE IF NOT EXISTS nas (
  id          INT NOT NULL AUTO_INCREMENT,
  nasname     VARCHAR(128) NOT NULL,
  shortname   VARCHAR(32)  DEFAULT NULL,
  type        VARCHAR(30)  NOT NULL DEFAULT 'other',
  ports       INT          DEFAULT NULL,
  server      VARCHAR(64)  DEFAULT NULL,
  community   VARCHAR(50)  DEFAULT NULL,
  description VARCHAR(200) NOT NULL DEFAULT 'RADIUS Client',
  secret      VARCHAR(60)  NOT NULL DEFAULT 'secret',
  require_ma  TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_nas_nasname (nasname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- radcheck: atribut pemeriksaan per user (password, dsb).
CREATE TABLE IF NOT EXISTS radcheck (
  id        INT NOT NULL AUTO_INCREMENT,
  username  VARCHAR(64)  NOT NULL DEFAULT '',
  attribute VARCHAR(64)  NOT NULL DEFAULT '',
  op        VARCHAR(2)   NOT NULL DEFAULT '==',
  value     VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radcheck_username (username(32)),
  UNIQUE KEY uq_radcheck_user_attr (username, attribute, op)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- radreply: atribut balasan per user (framed-pool, session-timeout, dsb).
CREATE TABLE IF NOT EXISTS radreply (
  id        INT NOT NULL AUTO_INCREMENT,
  username  VARCHAR(64)  NOT NULL DEFAULT '',
  attribute VARCHAR(64)  NOT NULL DEFAULT '',
  op        VARCHAR(2)   NOT NULL DEFAULT '=',
  value     VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radreply_username (username(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- radgroupcheck / radgroupreply: atribut tingkat grup (dipakai radusergroup).
CREATE TABLE IF NOT EXISTS radgroupcheck (
  id        INT NOT NULL AUTO_INCREMENT,
  groupname VARCHAR(64)  NOT NULL DEFAULT '',
  attribute VARCHAR(64)  NOT NULL DEFAULT '',
  op        VARCHAR(2)   NOT NULL DEFAULT '==',
  value     VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radgroupcheck_groupname (groupname(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radgroupreply (
  id        INT NOT NULL AUTO_INCREMENT,
  groupname VARCHAR(64)  NOT NULL DEFAULT '',
  attribute VARCHAR(64)  NOT NULL DEFAULT '',
  op        VARCHAR(2)   NOT NULL DEFAULT '=',
  value     VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radgroupreply_groupname (groupname(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- radusergroup: keanggotaan user pada grup.
CREATE TABLE IF NOT EXISTS radusergroup (
  id        INT NOT NULL AUTO_INCREMENT,
  username  VARCHAR(64) NOT NULL DEFAULT '',
  groupname VARCHAR(64) NOT NULL DEFAULT '',
  priority  INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_radusergroup_username (username(32)),
  KEY idx_radusergroup_groupname (groupname(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- radacct: akuntansi sesi. acctstoptime NULL = sesi masih berjalan.
CREATE TABLE IF NOT EXISTS radacct (
  radacctid           BIGINT NOT NULL AUTO_INCREMENT,
  acctsessionid       VARCHAR(64)  NOT NULL DEFAULT '',
  acctuniqueid        VARCHAR(32)  NOT NULL DEFAULT '',
  username            VARCHAR(64)  DEFAULT NULL,
  groupname           VARCHAR(64)  DEFAULT NULL,
  realm               VARCHAR(64)  DEFAULT NULL,
  nasipaddress        VARCHAR(45)  NOT NULL DEFAULT '',
  nasportid           VARCHAR(32)  DEFAULT NULL,
  nasporttype         VARCHAR(32)  DEFAULT NULL,
  acctstarttime       DATETIME     DEFAULT NULL,
  acctupdatetime      DATETIME     DEFAULT NULL,
  acctstoptime        DATETIME     DEFAULT NULL,
  acctinterval        INT          DEFAULT NULL,
  acctsessiontime     INT UNSIGNED DEFAULT NULL,
  acctauthentic       VARCHAR(32)  DEFAULT NULL,
  connectinfo_start   VARCHAR(50)  DEFAULT NULL,
  connectinfo_stop    VARCHAR(50)  DEFAULT NULL,
  acctinputoctets     BIGINT       DEFAULT NULL,
  acctoutputoctets    BIGINT       DEFAULT NULL,
  calledstationid     VARCHAR(50)  NOT NULL DEFAULT '',
  callingstationid    VARCHAR(50)  NOT NULL DEFAULT '',
  acctterminatecause  VARCHAR(32)  NOT NULL DEFAULT '',
  servicetype         VARCHAR(32)  DEFAULT NULL,
  framedprotocol      VARCHAR(32)  DEFAULT NULL,
  framedipaddress     VARCHAR(45)  NOT NULL DEFAULT '',
  framedipv6address   VARCHAR(45)  NOT NULL DEFAULT '',
  framedipv6prefix    VARCHAR(45)  NOT NULL DEFAULT '',
  framedinterfaceid   VARCHAR(44)  NOT NULL DEFAULT '',
  delegatedipv6prefix VARCHAR(45)  NOT NULL DEFAULT '',
  class               VARCHAR(64)  DEFAULT NULL,
  PRIMARY KEY (radacctid),
  UNIQUE KEY uq_radacct_uniqueid (acctuniqueid),
  KEY idx_radacct_username (username(32)),
  KEY idx_radacct_nasip (nasipaddress),
  KEY idx_radacct_stoptime (acctstoptime),
  KEY idx_radacct_start (acctstarttime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- radpostauth: jejak percobaan autentikasi (audit RADIUS).
CREATE TABLE IF NOT EXISTS radpostauth (
  id        BIGINT NOT NULL AUTO_INCREMENT,
  username  VARCHAR(64)  NOT NULL DEFAULT '',
  pass      VARCHAR(64)  NOT NULL DEFAULT '',
  reply     VARCHAR(32)  NOT NULL DEFAULT '',
  calledstationid   VARCHAR(50) NOT NULL DEFAULT '',
  callingstationid  VARCHAR(50) NOT NULL DEFAULT '',
  authdate  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  class     VARCHAR(64) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_radpostauth_username (username(32)),
  KEY idx_radpostauth_authdate (authdate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL _mig004_gate('post');

DROP PROCEDURE IF EXISTS _mig004_gate;

-- ============================================================================
-- ROLLBACK (manual, destruktif untuk riwayat RADIUS — bukan untuk panel):
--   mariadb isp_billing <<'SQL'
--   DROP TABLE IF EXISTS radpostauth, radacct, radusergroup, radgroupreply,
--                        radgroupcheck, radreply, radcheck, nas;
--   SQL
-- Data panel (customers, invoices, payments, users, config) tidak tersentuh
-- oleh rollback ini. Backup tetap wajib sebelum rollback.
-- ============================================================================
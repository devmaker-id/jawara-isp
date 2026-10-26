-- 003_customer_reseller_ownership.sql — kolom kepemilikan pelanggan (Jawara ISP)
-- Target: MariaDB 10.11.x, database isp_billing
-- STATUS: USULAN. BELUM DIJALANKAN DI PRODUKSI. Hanya boleh diuji di database
--         sekali-pakai (nama wajib mengandung 'test'/'isolat' atau berakhiran '_it').
--
-- Tujuan:
--   Menautkan satu pelanggan ke satu akun reseller (single owner). Aditif dan
--   nullable, sehingga kode lama tetap berjalan sebelum maupun sesudah migrasi.
--
--   * Semua pelanggan yang sudah ada menjadi reseller_id = NULL (tanpa pemilik).
--     TIDAK ada alokasi otomatis ke reseller mana pun.
--   * Pelanggan tanpa pemilik hanya boleh dilihat admin/operator.
--   * Perubahan pemilik hanya lewat endpoint admin (PATCH /customers/:id/owner)
--     yang menulis audit_logs dalam transaksi yang sama.
--
-- Kenapa ON DELETE SET NULL (bukan CASCADE):
--   Menghapus akun reseller tidak boleh menghapus pelanggan, tagihan, atau
--   riwayat pembayaran. Pelanggan kembali "tanpa pemilik" dan ditangani admin.
--   Catatan: pelepasan otomatis ini TIDAK menghasilkan baris audit (FK bekerja
--   di level database). Bila jejak audit wajib, lakukan pelepasan lewat endpoint
--   admin sebelum akun reseller dihapus permanen.
--
-- Tipe kolom: customers.id dan users.id bertipe INT (signed) → reseller_id WAJIB
-- INT signed juga. INT UNSIGNED akan gagal dengan ER_FK_INCOMPATIBLE_COLUMNS.
--
-- SIFAT DDL (penting):
--   MariaDB TIDAK menjalankan ALTER TABLE secara atomik. Bila pernyataan ALTER
--   berhenti di tengah (mis. FK gagal karena inkonsistensi), kolom atau indeks
--   bisa sudah terbentuk sebagian. Karena itu ada gerbang `pre`/`post`:
--     - `pre`  menolak jalan bila kolom sudah ada sebagian/lengkap,
--     - `post` memverifikasi kolom + indeks + FK setelah ALTER.
--   Bila gerbang `pre` melaporkan skema parsial, JANGAN mengulang ALTER;
--   periksa manual lebih dulu (lihat bagian VALIDASI).
--
-- PRECONDITION (wajib, sebelum menjalankan file ini):
--   1. Backup logis: mysqldump --single-transaction --routines isp_billing > dump.sql
--   2. Kolom customers.reseller_id belum ada (gerbang `pre` memeriksa).
--   3. Tabel users sudah ada dengan PK id INT (FK).
--   4. Tidak ada sesi DDL lain pada tabel customers (metadata lock).
--   5. Kode aplikasi yang berjalan sudah memuat penanganan kolom opsional
--      (hasOwnerColumn → 503 sebelum kolom ada, GET /customers/meta).

-- =====================================================================
-- UP
-- =====================================================================

DROP PROCEDURE IF EXISTS _mig003_gate;
DELIMITER $$
CREATE PROCEDURE _mig003_gate(IN p_phase VARCHAR(8))
BEGIN
  DECLARE v_column INT DEFAULT 0;
  DECLARE v_index INT DEFAULT 0;
  DECLARE v_fk INT DEFAULT 0;
  DECLARE v_rule VARCHAR(16) DEFAULT NULL;
  DECLARE v_coltype VARCHAR(64) DEFAULT NULL;
  DECLARE v_nullable VARCHAR(3) DEFAULT NULL;

  SELECT COUNT(*) INTO v_column
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
     AND COLUMN_NAME = 'reseller_id';

  SELECT COUNT(*) INTO v_index
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
     AND INDEX_NAME = 'idx_customers_reseller';

  SELECT COUNT(*) INTO v_fk
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
     AND CONSTRAINT_NAME = 'fk_customers_reseller' AND CONSTRAINT_TYPE = 'FOREIGN KEY';

  SELECT DELETE_RULE INTO v_rule
    FROM information_schema.REFERENTIAL_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
     AND CONSTRAINT_NAME = 'fk_customers_reseller';

  SELECT COLUMN_TYPE, IS_NULLABLE INTO v_coltype, v_nullable
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
     AND COLUMN_NAME = 'reseller_id';

  IF p_phase = 'pre' THEN
    IF v_column = 0 THEN
      IF v_index > 0 OR v_fk > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
          'MIGRASI 003 DIBATALKAN: indeks/fk_customers_reseller sudah ada tanpa kolom reseller_id (skema parsial). Periksa manual sebelum mengulang.';
      END IF;
    ELSE
      IF v_index > 0 AND v_fk > 0 AND v_rule = 'SET NULL' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
          'MIGRASI 003 TIDAK DIJALANKAN: kolom, indeks, dan FK sudah lengkap (migrasi sudah diterapkan).';
      ELSE
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
          'MIGRASI 003 DIBATALKAN: kolom reseller_id ada tetapi indeks/FK belum lengkap (skema parsial). Jangan ulangi ALTER; selesaikan manual lalu jalankan gerbang post.';
      END IF;
    END IF;
  ELSEIF p_phase = 'post' THEN
    IF v_column = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDASI 003 GAGAL: kolom customers.reseller_id tidak ada.';
    END IF;
    IF v_index = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDASI 003 GAGAL: indeks idx_customers_reseller tidak ada.';
    END IF;
    IF v_fk = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDASI 003 GAGAL: foreign key fk_customers_reseller tidak ada.';
    END IF;
    IF v_rule IS NULL OR v_rule <> 'SET NULL' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDASI 003 GAGAL: ON DELETE fk_customers_reseller bukan SET NULL.';
    END IF;
    IF v_nullable <> 'YES' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDASI 003 GAGAL: kolom reseller_id harus NULLABLE.';
    END IF;
    IF v_coltype <> 'int(11)' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDASI 003 GAGAL: tipe reseller_id harus INT (int(11)), bukan tipe lain.';
    END IF;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Gerbang 003 dipanggil dengan fase tidak dikenal (pakai pre/post).';
  END IF;
END$$
DELIMITER ;

CALL _mig003_gate('pre');

ALTER TABLE customers
  ADD COLUMN reseller_id INT DEFAULT NULL AFTER is_active,
  ADD KEY idx_customers_reseller (reseller_id),
  ADD CONSTRAINT fk_customers_reseller FOREIGN KEY (reseller_id)
      REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

CALL _mig003_gate('post');

DROP PROCEDURE IF EXISTS _mig003_gate;

-- =====================================================================
-- VALIDASI SESUDAH (jalankan terpisah, hanya SELECT)
-- =====================================================================
-- 1) Bentuk kolom, indeks, dan aturan FK:
--    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'reseller_id';
--    SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS
--     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND INDEX_NAME = 'idx_customers_reseller';
--    SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND CONSTRAINT_NAME = 'fk_customers_reseller';
-- 2) Tidak ada pelanggan yang otomatis punya pemilik:
--    SELECT COUNT(*) AS total, SUM(reseller_id IS NULL) AS tanpa_pemilik FROM customers;
--    -- keduanya harus sama setelah migrasi dijalankan pada data lama.
-- 3) Indeks benar-benar dipakai query reseller:
--    EXPLAIN SELECT id FROM customers WHERE reseller_id = 1;   -- key = idx_customers_reseller
-- 4) FK hanya menerima akun yang ada:
--    SELECT COUNT(*) FROM customers c LEFT JOIN users u ON u.id = c.reseller_id
--     WHERE c.reseller_id IS NOT NULL AND u.id IS NULL;        -- harus 0

-- =====================================================================
-- ROLLBACK (TIDAK memulihkan data penugasan — ekspor dulu!)
-- =====================================================================
-- 0) WAJIB sebelum rollback, simpan penugasan:
--      SELECT id, reseller_id FROM customers WHERE reseller_id IS NOT NULL;   -- simpan ke file
-- 1) Lepas FK, indeks, lalu kolom (urutan penting):
--      ALTER TABLE customers DROP FOREIGN KEY fk_customers_reseller;
--      ALTER TABLE customers DROP KEY idx_customers_reseller;
--      ALTER TABLE customers DROP COLUMN reseller_id;
-- 2) Setelah rollback, kode kembali ke jalur 503 (kolom tidak ada) dan seluruh
--    pelanggan kembali "tanpa pemilik" untuk reseller.
--
-- RISIKO ROLLBACK:
--   * Seluruh penugasan pemilik hilang bila langkah 0 dilewati. Tidak ada cara
--     memulihkannya tanpa backup/dump.
--   * Baris audit CUSTOMER_OWNER_ASSIGNED TETAP ada (audit_logs tidak dihapus),
--     tetapi tanpa kolom tujuan audit itu tidak bisa dipakai untuk rekonstruksi
--     otomatis — butuh parsing JSON details.
--   * Rollback juga DDL non-atomik: bila berhenti di tengah, kolom bisa hilang
--     sementara FK masih mencoba merujuknya. Periksa information_schema setelah
--     setiap langkah.
--   * Rollback TIDAK menyentuh invoices/service_sessions/payments: data turunan
--     tetap utuh karena tidak pernah diubah oleh migrasi ini.
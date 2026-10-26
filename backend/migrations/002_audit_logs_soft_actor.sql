-- 002_audit_logs_soft_actor.sql — jejak audit bertahan saat akun user dihapus
-- Target: MariaDB 10.11.x, database isp_billing
-- STATUS: USULAN. BELUM DIJALANKAN DI PRODUKSI. Sudah diuji di instance terpisah.
--
-- Alasan: audit_logs.user_id saat ini NOT NULL dengan FK ON DELETE CASCADE,
-- sehingga menghapus akun user (DELETE /api/admin/:id) menghapus seluruh jejak
-- audit-nya. Jejak pembayaran di tabel payments tetap ada (FK SET NULL), tapi
-- keterangan siapa pelakunya hilang dari audit.
--
-- Ada DUA lapis solusi:
--   A. Tanpa ubah skema (dipakai sejak versi pembayaran pertama):
--      - void wajib pelaku terautentikasi (voided_by selalu terisi),
--      - identitas pelaku disalin ke audit_logs.details sebagai snapshot JSON,
--      - hapus user ditolak (409) bila user punya jejak finansial di payments.
--      Ini sudah cukup selama user tidak pernah dihapus permanen.
--   B. Migrasi 002 (file ini): user_id nullable + FK SET NULL, sehingga baris
--      audit bertahan walau akunnya dihapus. Kolom tetap ada; nilainya NULL
--      untuk pelaku yang sudah tidak ada.

-- =====================================================================
-- UP
-- =====================================================================
ALTER TABLE audit_logs DROP FOREIGN KEY fk_audit_logs_user;
ALTER TABLE audit_logs MODIFY user_id INT DEFAULT NULL;
ALTER TABLE audit_logs
  ADD CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id)
  REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- BUKTI
-- =====================================================================
-- SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs';   -- SET NULL
-- SELECT IS_NULLABLE FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'user_id'; -- YES
-- Uji: INSERT audit_logs (user_id=<ada>), DELETE user tsb, baris audit harus
-- tetap ada dengan user_id NULL.

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- PENTING: rollback TIDAK boleh langsung MODIFY ... NOT NULL. Bila sudah ada
-- baris user_id NULL, MariaDB menolak:
--   ERROR 1830 (HY000): Column 'user_id' cannot be NOT NULL: needed in a
--   foreign key constraint 'fk_audit_logs_user' SET NULL
-- Urutan rollback yang benar:
--   1) Arsipkan baris tanpa pelaku:
--        CREATE TABLE audit_logs_orphan AS SELECT * FROM audit_logs WHERE user_id IS NULL;
--   2) Hapus dari tabel utama:
--        DELETE FROM audit_logs WHERE user_id IS NULL;
--   3) Lepas FK, kencangkan kolom, pasang kembali FK CASCADE:
--        ALTER TABLE audit_logs DROP FOREIGN KEY fk_audit_logs_user;
--        ALTER TABLE audit_logs MODIFY user_id INT NOT NULL;
--        ALTER TABLE audit_logs
--          ADD CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id)
--          REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
--
-- RISIKO ROLLBACK:
--   * Baris audit pelaku-tanpa-akun harus diarsipkan manual (tabel
--     audit_logs_orphan) atau akan hilang dari tabel utama.
--   * Setelah rollback, menghapus user kembali menghapus jejak audit-nya.

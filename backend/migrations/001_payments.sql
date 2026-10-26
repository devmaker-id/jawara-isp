-- 001_payments.sql — tabel payments + void + enum partial (Jawara ISP)
-- Target: MariaDB 10.11.x, database isp_billing
-- STATUS: BELUM DIJALANKAN DI PRODUKSI. Hanya diuji di database sekali-pakai.
--
-- Prinsip:
--   * Nominal terbayar = SUM(payments.amount WHERE voided_at IS NULL).
--     Tidak ada kolom invoices.paid_amount (satu sumber kebenaran, tidak ada
--     cache yang bisa menyimpang).
--   * payments append-only. Pembayaran tidak pernah dihapus; koreksi lewat void
--     (voided_at + voided_by + void_reason). Riwayat tetap tersimpan.
--   * Overdue tidak disimpan dan tidak ada update status massal; overdue
--     diturunkan saat baca. Status tersimpan hanya unpaid/partial/paid.
--
-- Catatan tipe kolom: invoices.id dan users.id bertipe INT (signed), jadi
-- kolom FK WAJIB INT signed juga. INT UNSIGNED -> ER_FK_INCOMPATIBLE_COLUMNS.
--
-- CATATAN AUDIT (lihat 002_audit_logs_soft_actor.sql):
-- setiap void WAJIB menulis baris audit_logs. Skema audit_logs saat ini punya
-- fk_audit_logs_user ON DELETE CASCADE, sehingga menghapus akun user ikut
-- menghapus jejak audit-nya. Mitigasi yang dipakai sekarang TANPA ubah skema:
--   1) aksi void ditolak bila pelaku tidak terautentikasi (voided_by selalu terisi),
--   2) identitas pelaku disalin ke audit_logs.details (snapshot JSON),
--   3) hapus user ditolak (409) bila user punya jejak finansial
--      (payments.recorded_by / voided_by) -> arahkan ke nonaktifkan (is_active).
-- Solusi struktural (audit_logs.user_id nullable + FK SET NULL) ada di 002 dan
-- BELUM dijalankan.

-- =====================================================================
-- UP
-- =====================================================================

-- 'partial' DITAMBAHKAN DI AKHIR daftar enum supaya nomor indeks nilai lama
-- tidak berubah (1=unpaid, 2=paid, 3=overdue tetap sama). Tidak ada UPDATE
-- status massal: baris lama tidak disentuh.
ALTER TABLE invoices
  MODIFY status ENUM('unpaid','paid','overdue','partial') NOT NULL DEFAULT 'unpaid';

CREATE TABLE IF NOT EXISTS payments (
  id INT NOT NULL AUTO_INCREMENT,
  invoice_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('cash','transfer','qris','other') NOT NULL DEFAULT 'cash',
  reference VARCHAR(64) DEFAULT NULL,
  paid_at DATETIME NOT NULL,
  recorded_by INT DEFAULT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  idempotency_key VARCHAR(64) DEFAULT NULL,
  voided_at DATETIME DEFAULT NULL,
  voided_by INT DEFAULT NULL,
  void_reason VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_idempotency (invoice_id, idempotency_key),
  KEY idx_payments_invoice (invoice_id),
  KEY idx_payments_paid_at (paid_at),
  KEY idx_payments_reference (reference),
  KEY idx_payments_recorded_by (recorded_by),
  KEY idx_payments_voided_at (voided_at),
  KEY idx_payments_voided_by (voided_by),
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id)
    REFERENCES invoices (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_user FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payments_voided_by FOREIGN KEY (voided_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_payments_amount CHECK (amount > 0),
  -- Void wajib lengkap: voided_at dan void_reason terisi bersamaan, alasan
  -- tidak boleh kosong/spasi. voided_by boleh NULL bila akun user dihapus
  -- (ON DELETE SET NULL); jejak void tetap ada di voided_at + void_reason.
  CONSTRAINT chk_payments_void CHECK (
    (voided_at IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND void_reason IS NOT NULL
        AND CHAR_LENGTH(TRIM(void_reason)) > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- BACKFILL — hanya invoice berstatus 'paid' DAN punya paid_date.
-- Nilai berasal dari data invoice lama, bukan log transaksi asli; note
-- menandainya sebagai rekonstruksi supaya tidak disalahartikan.
-- Idempotent: NOT EXISTS mencegah baris ganda saat migrasi diulang.
--
-- Gerbang konsistensi FAIL-CLOSED: setiap invoice 'paid' ber-paid_date harus
-- terwakili penuh oleh pembayaran sah. Bila tidak, migrasi WAJIB gagal:
-- SIGNAL membuat mysql keluar dengan status bukan 0, koneksi ditutup, dan
-- transaksi backfill di-rollback (tidak ada baris karangan yang masuk).
--
-- Prosedur gate dibuat SEBELUM START TRANSACTION. Wajib: CREATE PROCEDURE
-- adalah DDL dan MariaDB melakukan implicit commit, sehingga bila diletakkan
-- di tengah transaksi, baris backfill sudah ter-commit sebelum gate dinilai
-- (terbukti pada uji: exit 1 tetapi baris backfill tetap masuk).
-- Bila gate gagal, prosedur ini tertinggal (tidak berbahaya); DROP IF EXISTS
-- di baris pertama membersihkannya pada percobaan berikutnya.
-- =====================================================================
DROP PROCEDURE IF EXISTS _mig001_gate;
DELIMITER $$
CREATE PROCEDURE _mig001_gate()
BEGIN
  DECLARE v_bad INT DEFAULT 0;
  SELECT COUNT(*) INTO v_bad FROM (
    SELECT i.id
    FROM invoices i
    LEFT JOIN payments p ON p.invoice_id = i.id AND p.voided_at IS NULL
    WHERE i.status = 'paid' AND i.paid_date IS NOT NULL
    GROUP BY i.id, i.amount
    HAVING COALESCE(SUM(p.amount), 0) <> i.amount
  ) AS t;
  IF v_bad > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
      'MIGRASI 001 DIBATALKAN: ada invoice paid yang total pembayaran sahnya tidak sama dengan nominal. Perbaiki datanya dulu; jangan dipaksa lunas dengan angka karangan.';
  END IF;
END$$
DELIMITER ;

START TRANSACTION;

INSERT INTO payments (invoice_id, amount, method, paid_at, note)
SELECT i.id,
       i.amount,
       'other',
       TIMESTAMP(i.paid_date, '00:00:00'),
       'Rekonstruksi backfill migrasi 001: dibentuk dari data invoice lama '
       '(status paid + paid_date), bukan log transaksi pembayaran asli'
FROM invoices i
WHERE i.status = 'paid'
  AND i.paid_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id);

CALL _mig001_gate();

COMMIT;

DROP PROCEDURE IF EXISTS _mig001_gate;

-- =====================================================================
-- BUKTI (jalankan setelah UP+BACKFILL; hasilnya dilaporkan)
-- =====================================================================
-- 1) invoice paid+paid_date == invoice yang punya pembayaran sah
-- SELECT (SELECT COUNT(*) FROM invoices WHERE status='paid' AND paid_date IS NOT NULL) AS paid_invoices,
--        (SELECT COUNT(DISTINCT invoice_id) FROM payments WHERE voided_at IS NULL) AS invoices_with_payment;
-- 2) nominal cocok
-- SELECT (SELECT SUM(amount) FROM invoices WHERE status='paid' AND paid_date IS NOT NULL) AS total_invoice_paid,
--        (SELECT SUM(amount) FROM payments WHERE voided_at IS NULL) AS total_payment_valid;
-- 3) tidak ada overpay
-- SELECT p.invoice_id, SUM(p.amount) AS paid, i.amount
-- FROM payments p JOIN invoices i ON i.id = p.invoice_id
-- WHERE p.voided_at IS NULL
-- GROUP BY p.invoice_id, i.amount HAVING paid > i.amount;
-- 4) tidak ada void setengah jadi (harus 0 baris; dijaga CHECK juga)
-- SELECT id FROM payments
-- WHERE (voided_at IS NULL) <> (void_reason IS NULL)
--    OR (voided_at IS NOT NULL AND TRIM(void_reason) = '');

-- =====================================================================
-- ROLLBACK (aman, urutannya penting, hanya untuk database sekali-pakai)
-- =====================================================================
-- 0) Ekspor dulu bila ada data yang perlu disimpan:
--      SELECT * FROM payments;            -- simpan ke file
-- 1) Kembalikan status 'partial' SEBELUM enum dipersempit; ALTER gagal bila
--    masih ada baris 'partial'. Tidak ada pelunasan massal: hanya partial yang
--    dikembalikan ke unpaid karena skema lama tidak mengenal nilai itu.
--      UPDATE invoices SET status = 'unpaid', paid_date = NULL WHERE status = 'partial';
-- 2) Persempit enum ke bentuk semula (urutan nilai lama tetap):
--      ALTER TABLE invoices MODIFY status ENUM('unpaid','paid','overdue') NOT NULL DEFAULT 'unpaid';
-- 3) Hapus tabel ledger:
--      DROP TABLE IF EXISTS payments;
--
-- RISIKO ROLLBACK:
--   * Seluruh ledger pembayaran (termasuk data void) hilang bila langkah 0
--     dilewati.
--   * Invoice yang partial kembali 'unpaid' dan paid_date-nya dikosongkan;
--     rincian pembayaran hanya ada di ekspor langkah 0.
--   * Invoice paid hasil backfill tetap 'paid' walau ledger hilang, karena
--     migrasi tidak mengubah kolom invoices -> tetap konsisten dengan skema lama.

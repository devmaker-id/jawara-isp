-- 024_primary_admin.sql
-- Administrator utama: akun yang tidak boleh dihapus.
--
-- Aturan yang diberlakukan di panel:
--   - admin boleh menghapus akun ber-role apa pun (admin/operator/resseler),
--     KECUALI administrator utama;
--   - penghapusan hanya berhasil bila akun itu tidak terikat data warisan
--     (pelanggan, voucher, profil, jejak audit, pembayaran).
--
-- Kolom ditandai satu baris saja. Kalau nanti pemilik panel ingin memindahkan
-- status ini, cukup ubah kolomnya — tidak perlu mengubah kode.
--
-- Sifat: additive + idempoten.

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'is_primary'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE users ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0 AFTER role',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Tetapkan administrator utama bila belum ada: admin aktif tertua (id terkecil).
-- Kalau sudah ada, perintah ini tidak mengubah apa pun.
SET @has_primary := (SELECT COUNT(*) FROM users WHERE is_primary = 1);
UPDATE users
   SET is_primary = 1
 WHERE @has_primary = 0
   AND id = (
     SELECT id FROM (
       SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1
     ) AS oldest_admin
   );

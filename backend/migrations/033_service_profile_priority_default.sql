-- 033_service_profile_priority_default.sql
-- Prioritas queue MikroTik: 1 = paling tinggi, 8 = paling rendah.
--
-- Profil layanan hotspot & PPP masih memakai DEFAULT 1 sejak migrasi 006,
-- sehingga setiap profil baru otomatis mendapat prioritas TERTINGGI. Default
-- diubah ke 8 (paling rendah) agar pelanggan biasa berbagi antrean di ujung
-- belakang; operator tetap bisa memilih 1-8 di form bila perlu.
--
-- Data yang sudah ada TIDAK diubah: memindahkan prioritas profil yang sedang
-- dipakai akan menggeser antrean pelanggan yang sedang berjalan.
--
-- Sifat: additive + idempoten (aman dijalankan dua kali).

SET @default_hs := (
  SELECT COLUMN_DEFAULT FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'hotspot_profiles'
     AND column_name = 'priority'
);

SET @sql := IF(@default_hs <> '8',
  'ALTER TABLE hotspot_profiles ALTER COLUMN priority SET DEFAULT 8',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @default_ppp := (
  SELECT COLUMN_DEFAULT FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'ppp_profiles'
     AND column_name = 'priority'
);

SET @sql := IF(@default_ppp <> '8',
  'ALTER TABLE ppp_profiles ALTER COLUMN priority SET DEFAULT 8',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- BUKTI
-- =====================================================================
-- SELECT table_name, column_default FROM information_schema.columns
--  WHERE table_schema = DATABASE() AND column_name = 'priority';
-- -- hotspot_profiles & ppp_profiles harus 8.
--
-- Uji di transaksi (tidak menyimpan baris):
--   START TRANSACTION;
--   INSERT INTO hotspot_profiles (name, owner_id, group_id) VALUES ('uji-033', NULL, 1);
--   SELECT priority FROM hotspot_profiles WHERE name = 'uji-033';  -- harus 8
--   ROLLBACK;

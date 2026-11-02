-- rollback/033_service_profile_priority_default_down.sql
-- Mengembalikan default prioritas profil layanan ke nilai sebelum 033 (=1).
--
-- AMAN: hanya mengubah nilai DEFAULT kolom; prioritas yang sudah tersimpan di
-- baris lama tidak diubah. Idempoten (aman dijalankan dua kali).

SET @sql := IF((SELECT COLUMN_DEFAULT FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'hotspot_profiles'
                   AND column_name = 'priority') <> '1',
  'ALTER TABLE hotspot_profiles ALTER COLUMN priority SET DEFAULT 1', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COLUMN_DEFAULT FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'ppp_profiles'
                   AND column_name = 'priority') <> '1',
  'ALTER TABLE ppp_profiles ALTER COLUMN priority SET DEFAULT 1', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

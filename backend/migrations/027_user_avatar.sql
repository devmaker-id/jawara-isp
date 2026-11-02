-- 027_user_avatar.sql
-- Foto profil pengguna.
--
-- Endpoint /api/auth/avatar sudah lama menulis berkas ke disk tetapi tidak
-- dapat menyimpan rujukannya: tabel `users` belum punya kolom untuk itu, dan
-- controller-nya sengaja menjawab "menunggu migrasi kolom avatar". Migrasi ini
-- menutup celah tersebut. Additive + nullable: baris lama tidak berubah dan
-- pengguna tanpa foto tetap NULL.
--
-- Sifat: additive + idempoten.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(255) NULL AFTER address;

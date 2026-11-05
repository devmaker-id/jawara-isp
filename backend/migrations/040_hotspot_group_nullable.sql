-- ============================================================================
-- 040_hotspot_group_nullable.sql
-- Group Profile jadi OPSIONAL untuk profil hotspot: NULL berarti "pakai profil
-- hotspot bawaan router" (mode DEFAULT, tanpa membuat grup lebih dulu).
-- Profil PPP tetap WAJIB punya group profile (pool/gateway berasal dari grup).
--
-- Kolom `group_profile_id` dibuat nullable di dua tabel:
--   * hotspot_profiles  — profil layanan hotspot boleh tanpa grup.
--   * radius_vouchers    — voucher/member dari profil DEFAULT menyimpan NULL.
--
-- FK tetap berlaku: nilai NULL berarti "tidak mereferensikan grup mana pun"
-- (perilaku standar FK), jadi integritas tidak melemah.
--
-- Non-destruktif dan reversibel: baris lama tetap punya nilai, hanya kolom yang
-- diizinkan NULL. Rollback = ubah kembali ke NOT NULL (selama tidak ada baris
-- NULL yang sudah disimpan).
-- ============================================================================

ALTER TABLE hotspot_profiles MODIFY COLUMN group_profile_id INT NULL;
ALTER TABLE radius_vouchers MODIFY COLUMN group_profile_id INT NULL;
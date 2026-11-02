-- 025_olt_admin_operator_only.sql
-- Modul OLT hanya untuk admin & operator.
--
-- Perangkat OLT menyimpan kredensial jaringan akses dan inventori ONU seluruh
-- pelanggan. Reseller tidak perlu — dan tidak boleh — melihatnya, termasuk
-- lewat penimpaan izin per akun.
--
-- Yang dilakukan di sini hanya satu hal: `olt.view` untuk role reseller
-- dimatikan pada matriks role. Penimpaan per akun milik reseller (kalau ada)
-- juga dibersihkan, karena penimpaan itu menang atas nilai role dan akan tetap
-- membuka akses meski role-nya sudah dicabut.
--
-- Sifat: idempoten.

UPDATE role_permissions
   SET allowed = 0
 WHERE role = 'resseler'
   AND code LIKE 'olt.%';

DELETE up FROM user_permissions up
  JOIN users u ON u.id = up.user_id
 WHERE u.role = 'resseler'
   AND up.code LIKE 'olt.%';

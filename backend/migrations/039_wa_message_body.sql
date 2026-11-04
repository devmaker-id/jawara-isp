-- 039_wa_message_body.sql
-- Simpan isi pesan WhatsApp penuh (TEXT) di samping body_preview (200 char),
-- supaya halaman Riwayat Pesan bisa menampilkan detail isi lengkap.
--
-- body_preview tetap dipakai untuk baris tabel; body untuk tampilan detail.
-- Pesan lama (sebelum kolom ini) akan ber-body NULL — tampilan detail jatuh
-- ke body_preview.
--
-- Sifat: idempoten (ADD COLUMN IF NOT EXISTS didukung MariaDB).

ALTER TABLE wa_messages
  ADD COLUMN IF NOT EXISTS body TEXT NULL AFTER body_preview;
-- Tahap 1 model billing: tipe pembayaran + tanggal jatuh tempo per customer.
-- billing_day NULL = fallback ke tanggal registrasi (DAY(created_at)).
-- next_billing_day = perubahan tanggal tagihan yang tertunda (berlaku siklus berikutnya).
ALTER TABLE customers
  ADD COLUMN billing_type ENUM('prepaid','postpaid') NOT NULL DEFAULT 'prepaid',
  ADD COLUMN billing_day TINYINT UNSIGNED NULL,
  ADD COLUMN next_billing_day TINYINT UNSIGNED NULL;
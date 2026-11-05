-- Rekonsiliasi istilah: akun terikat customer (dulunya 'member') → 'customer'.
-- Kendala CHECK lama hanya mengenal 'voucher'/'member'; diperbarui dulu agar
-- bisa menulis 'customer', lalu enum 'member' dihapus.
ALTER TABLE radius_vouchers DROP CONSTRAINT ck_voucher_customer;
UPDATE radius_vouchers SET user_type = 'customer' WHERE user_type = 'member';
ALTER TABLE radius_vouchers
  MODIFY user_type ENUM('voucher','customer') NOT NULL DEFAULT 'voucher';
ALTER TABLE radius_vouchers
  ADD CONSTRAINT ck_voucher_customer CHECK (
    (user_type = 'voucher' AND customer_id IS NULL) OR
    (user_type = 'customer' AND customer_id IS NOT NULL)
  );
-- Titik pengakuan pendapatan voucher: diisi saat login pertama sukses.
-- Customer (prepaid/postpaid) TIDAK memakai kolom ini — pendapatannya lewat invoices.revenue_recognized_at.
ALTER TABLE radius_vouchers
  ADD COLUMN revenue_recognized_at DATETIME NULL;
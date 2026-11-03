-- 036_customer_credit_limit.sql
-- Batas piutang per pelanggan untuk perpanjangan layanan dengan piutang.
--
-- Model piutang TIDAK membuat tabel baru: saldo piutang = sisa tagihan pada
-- `invoices` yang belum lunas dan belum void, dikurangi pembayaran sah
-- (`payments.voided_at IS NULL`). Yang ditambahkan hanya batas kredit per
-- pelanggan; nilai bawaan 0 = piutang tidak diizinkan (bukan tak terbatas).
--
-- Sifat: additive + idempoten. Tidak mengubah tagihan/pembayaran yang ada.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER status;

-- Bukti: SELECT id, name, credit_limit FROM customers LIMIT 5;
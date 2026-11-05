-- Tahap 1b model billing: titik pengakuan pendapatan pada invoice.
-- prepaid : diisi saat invoice dibuat (lunas → pendapatan langsung).
-- postpaid: diisi saat masa pakai habis (accrual → pendapatan diakui meski belum dibayar).
ALTER TABLE invoices
  ADD COLUMN revenue_recognized_at DATETIME NULL;
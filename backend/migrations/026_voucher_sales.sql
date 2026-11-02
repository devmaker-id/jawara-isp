-- 026_voucher_sales.sql
-- Penjualan voucher sebagai transaksi.
--
-- Voucher adalah barang yang dijual, jadi pendapatannya harus DICATAT sebagai
-- uang masuk — bukan disimpulkan dari "voucher pernah login". Login pertama
-- tetap dipakai untuk memulai masa aktif (first_login_at), tetapi itu peristiwa
-- jaringan, bukan penjualan.
--
-- Yang disimpan per penjualan:
--   harga modal (cost_price) dan harga jual (sell_price) → laba bisa dihitung
--   quantity        → satu baris boleh mewakili beberapa voucher
--   owner_id        → pemilik data (reseller/operator), dasar filter laporan
--   recorded_by     → siapa yang mencatat
--   voided_at/by    → pembatalan tanpa menghapus jejak
--
-- voucher_id sengaja TANPA foreign key: voucher bisa dihapus/di-rotate, tetapi
-- catatan uangnya harus tetap ada. `username` disalin sebagai jejak saat jual.
--
-- Sifat: additive + idempoten.

CREATE TABLE IF NOT EXISTS voucher_sales (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  voucher_id    BIGINT       NULL,
  username      VARCHAR(120) NULL,
  profile_name  VARCHAR(120) NOT NULL DEFAULT '',
  profile_type  ENUM('hotspot','ppp') NOT NULL DEFAULT 'hotspot',
  quantity      INT          NOT NULL DEFAULT 1,
  cost_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  sell_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  owner_id      INT          NULL,
  recorded_by   INT          NULL,
  buyer_name    VARCHAR(120) NULL,
  method        ENUM('cash','transfer','qris','other') NOT NULL DEFAULT 'cash',
  note          VARCHAR(191) NULL,
  sold_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at     DATETIME     NULL,
  voided_by     INT          NULL,
  void_reason   VARCHAR(191) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_voucher_sales_date (sold_at),
  KEY idx_voucher_sales_owner (owner_id, sold_at),
  KEY idx_voucher_sales_recorder (recorded_by, sold_at),
  KEY idx_voucher_sales_voucher (voucher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Izin: siapa boleh mencatat penjualan voucher.
-- Semua role yang boleh menghasilkan voucher juga boleh mencatat penjualannya;
-- pembatalan (void) dibatasi admin/operator, sama seperti pembayaran.
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, label, module, sort) VALUES
  ('voucher.sell', 'Catat penjualan voucher', 'voucher', 25),
  ('voucher.void', 'Batalkan penjualan voucher', 'voucher', 45)
ON DUPLICATE KEY UPDATE label = VALUES(label), module = VALUES(module), sort = VALUES(sort);

INSERT INTO role_permissions (role, code, allowed)
SELECT 'admin', code, 1 FROM permissions WHERE code IN ('voucher.sell', 'voucher.void')
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);

INSERT INTO role_permissions (role, code, allowed)
SELECT 'operator', code, IF(code = 'voucher.sell', 1, 1) FROM permissions WHERE code IN ('voucher.sell', 'voucher.void')
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);

INSERT INTO role_permissions (role, code, allowed)
SELECT 'resseler', code, IF(code = 'voucher.sell', 1, 0) FROM permissions WHERE code IN ('voucher.sell', 'voucher.void')
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);

-- rollback/035_service_renewals_down.sql
-- Menghapus catatan perpanjangan. Aman: invoice & pembayaran tetap ada,
-- tidak ada data pelanggan/RADIUS yang disentuh. Idempoten.

DROP TABLE IF EXISTS service_renewals;
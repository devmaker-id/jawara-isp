-- rollback/034_config_value_mediumtext_down.sql
-- Kembalikan config_value ke TEXT. JALANKAN HANYA bila semua nilai <= 65.535
-- byte; kalau tidak, ALTER akan gagal / memotong data.
SELECT MAX(CHAR_LENGTH(config_value)) AS terpanjang FROM config;
ALTER TABLE config MODIFY config_value TEXT NOT NULL;

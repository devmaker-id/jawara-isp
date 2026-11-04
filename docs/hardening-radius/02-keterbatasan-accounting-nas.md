# Keterbatasan Accounting MikroTik (RAM-only) — CATATAN RESMI

Tanggal: 2026-11-04. Konteks: single-server Bit78, NAS Gajrug (10.199.99.2) & sw-core (192.168.100.10).

## Kesimpulan

`accounting-backup` di RouterOS **BUKAN** "buffer accounting lokal saat server mati".
Menurut dokumentasi resmi RouterOS:

> `accounting-backup (yes|no; default no)` — "Whether the configuration is for the **backup
> RADIUS server**" (entri ini adalah server RADIUS *cadangan*).

Artinya flag itu untuk topologi **dua server RADIUS** (primary + backup), bukan untuk menyimpan
paket accounting yang gagal terkirim.

## Perilaku nyata saat RADIUS tidak terjangkau

1. RouterOS melakukan **retry/resend accounting di memori (RAM)** selama server tidak menjawab.
   Terlihat lewat `/radius monitor` → kolom `pending`, `resends`, `timeouts`.
2. **Tidak ada antrean persisten.** Jika NAS reboot / mati listrik saat RADIUS sedang down,
   accounting yang belum terkirim **hilang permanen**. Tidak ada opsi RouterOS untuk
   menyimpannya ke disk.
3. `accounting-backup=yes` pada entri `/radius` tunggal justru membuat entri itu dianggap
   "server cadangan" tanpa server utama → berisiko accounting tidak terkirim normal.

## Konsekuensi untuk ketahanan

- **Server RADIUS down + NAS tetap hidup:** accounting di-resend dari RAM selama down, lalu
  dikirim saat server pulih. Celah = RAM terbatas + durasi down; UDP tetap best-effort.
- **NAS mati/reboot saat RADIUS down:** accounting interim/stop yang belum terkirim **hilang**.
  Setelah NAS hidup lagi, sesi lama di NAS sudah punah (baris radacct jadi "basi"), pelanggan
  reconnect membuat sesi baru.

## Keputusan (per arahan user, 4 Nov 2026)

- **TIDAK** mengubah konfigurasi `/radius` di Gajrug maupun sw-core.
- Pertahankan interim-update **5m (300s)**.
- **TIDAK** mengaktifkan `accounting-backup` pada entri RADIUS tunggal.
- Mitigasi celah RAM-only ditangani di sisi lain:
  - Interim-update 5m membatasi kehilangan data per sesi.
  - Monitoring (Tahap 3) mendeteksi `pending/resends` naik sebagai sinyal dini RADIUS down.
  - Rekonsiliasi (Tahap 4) menutup celah identitas sesi tanpa menulis `radacct` otomatis.
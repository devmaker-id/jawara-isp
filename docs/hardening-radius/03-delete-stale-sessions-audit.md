# Audit `delete_stale_sessions` (FreeRADIUS 3.2.5 / rlm_sql)

Tanggal: 2026-11-04. Status: AUDIT READ-ONLY — tidak ada perubahan file root maupun generator.

## Apa itu `delete_stale_sessions`

Dokumentasi rlm_sql (man page & upstream):

> "If you are doing Simultaneous-Use checking, and this is set to yes, stale sessions
> (defined as sessions for which a Stop record was not received) will be cleared."

Poin penting dari arsip milis FreeRADIUS (tidak ada yang saya karang):

- FreeRADIUS **bukan sistem cron** — `delete_stale_sessions` **tidak** menjalankan pembersihan
  periodik, dan **tidak** dipicu oleh server start/restart.
- Opsi ini hanya berperan di dalam alur **Simultaneous-Use** saat login: `simul_count_query`
  menghitung baris `radacct` yang `acctstoptime IS NULL`, lalu `simul_verify_query` +
  `checkrad` memverifikasi sesi yang "dicurigai" ke NAS. Bila checkrad menyimpulkan sesi itu
  stale (NAS tidak punya sesinya), dan `delete_stale_sessions=yes`, maka **baris stale tersebut
  dihapus dari `radacct`.

## Keadaan produksi

- Konfigurasi aktif: `delete_stale_sessions = yes` (site `jawara`, `session { sql }`).
- `simul_count_query` dan `simul_verify_query` aktif (query bawaan, `acctstoptime IS NULL`).
- Grup yang memakai `Simultaneous-Use=1`: `3000-5h-1d`, `UJI-T1-PPP`, `2 hari 6 jam`,
  `hotspot-bahir`, `Profile-gratisan`, `vcr-3000`, `vcr-3000#25`, `paket 100k`.
  Grup aktif terpasang ke user: `Profile-gratisan`, `vcr-3000`, `vcr-3000#25`, `paket 100k`.

## Bukti empiris sejauh ini (tidak menghapus radacct)

- FreeRADIUS restart 04:49 & 13:18 WIB hari ini, baris "basi" `toni` (tanpa Stop) **tetap utuh**
  di `radacct`. Konsisten dengan temuan "tidak dipicu oleh restart".

## Analisis risiko (belum terbukti di produksi, perlu uji terkontrol)

Skenario yang BISA memicu penghapusan baris `radacct` lewat jalur ini:

1. Pelanggan `X` (grup `Simultaneous-Use=1`) punya sesi "basi" — NAS sudah tidak punya sesinya,
   tapi `radacct` masih `acctstoptime IS NULL` (karena Accounting-Stop hilang).
2. Pelanggan `X` login ulang. FreeRADIUS menjalankan sim-use: `simul_count_query` menemukan 1
   sesi terbuka.
3. `checkrad` memverifikasi ke NAS; NAS menjawab "tidak ada sesi X".
4. Dengan `delete_stale_sessions=yes`, baris basi itu **dihapus** (bukan ditandai), lalu login
   baru diizinkan.

Akibat: **historis accounting "basi" hilang diam-diam**, tepat saat pelanggan reconnect setelah
outage — skenario yang justru paling butuh jejak.

Catatan ketidakpastian:
- `checkrad` harus berhasil menjangkau NAS (SNMP/telnet/API — dukungannya bervariasi per tipe
  NAS). Untuk MikroTik, konfigurasi default sering kali TIDAK memverifikasi apa pun, sehingga
  perilaku nyata bisa berbeda. Ini yang harus diuji di Tahap 5/uji terkontrol, bukan ditebak.

## Konsekuensi bila diubah ke `no`

- rlm_sql **tidak akan menghapus** baris stale dari `radacct` (histori aman — sesuai prinsip).
- Efek samping: `simul_count_query` tetap menghitung sesi "basi" sebagai sesi terbuka, sehingga
  `Simultaneous-Use=1` bisa **memblokir login ulang** pelanggan yang sesinya menggantung.
- Trade-off: `yes` = login lancar tapi historis bisa terpotong; `no` = historis utuh tapi
  pelanggan bisa terblokir (butuh cara lain untuk menutup/menandai sesi basi).

## Rekomendasi

1. **Jangan ubah `delete_stale_sessions` dulu.** Kedua arah punya trade-off nyata yang harus
   dipilih lewat uji terkontrol dan keputusan bisnis (bukan diperbaiki membuta).
2. Arah yang konsisten dengan prinsip "radacct sumber kebenaran tunggal" adalah `no` +
   **rekonsiliasi eksplisit** (Tahap 4) yang menutup sesi basi dengan `acctstoptime` sintetis
   DAN `acctterminatecause='NAS-Reboot'`/`Lost-Carrier` — tercatat, teraudit, bukan hapus diam-diam.
3. Sebelum keputusan akhir, uji ulang skenario reconnect dengan `Simultaneous-Use=1` di
   **lingkungan isolasi** (biarkan `delete_stale_sessions=yes` dulu) untuk memastikan
   `checkrad` benar-benar melakukan verifikasi — jangan diasumsikan.

## Batas pengerjaan (dipatuhi)

- Tidak ada perubahan file root-owned (`/usr/local/sbin/jawara-radius-config`) atau generator.
- Tidak ada `apply`/`reload`/`restart` FreeRADIUS.
- Tidak ada hapus/ubah baris `radacct`.
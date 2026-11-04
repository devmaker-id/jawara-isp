# Audit Hardening RADIUS Accounting — Jawara-ISP (Tahap 1, read-only)

Tanggal audit: 2026-11-04 (WIB). Host: bit78. Prinsip: tidak ada perubahan konfigurasi/database.

## 1. NAS & RouterOS

Tabel `nas`:
- id=27  10.199.99.2   "Jmnt Gajrug"      mikrotik, ROS6(long-term) 6.49.22, require_ma=0 — SATU-SATUNYA pengirim accounting ke radacct (18 sesi, 3 terbuka).
- id=14  192.168.100.10 "sw-core"          mikrotik, ROS7 7.24.2 stable, require_ma=1, label "practice ROS7" — belum pernah kirim accounting.

Perangkat (mikrotik_devices, 6 baris aktif, semua last_connected=1 / API reachable):
- Gajrug 10.199.99.2  (ROS 6.49.22 LTS) — NAS produksi.
- Switch Core Edge 192.168.100.10 (ROS 7.24.2 stable) — practice, belum akuntansi.

## 2. Konfigurasi RADIUS di NAS (print read-only)

Gajrug (`/ppp aaa`): use-radius=true, accounting=true, interim-update=5m.
Gajrug (`/radius`): service ppp,hotspot → address 10.199.99.1, auth 1812/acct 1813,
  timeout 3s, **accounting-backup=false**, require-message-auth=yes-for-request-resp.
Gajrug (`/ip hotspot profile hs-gajrug`): radius-interim-update=5m, radius-accounting=true,
  use-radius=true, idle-timeout 5m, nas-port-type wireless-802.11.
sw-core (`/ppp aaa`): interim-update=5m; `/radius` → 192.168.100.253, accounting-backup=false, "practice".

=> Persyaratan "Interim-Update 300 detik" (Tahap 2) SUDAH terpenuhi di kedua sisi (5m = 300s).

## 3. FreeRADIUS

- Versi: 3.2.5 (x86_64, paket Ubuntu).
- systemd: freeradius.service enabled + active; drop-in `restart.conf`:
  Restart=always, RestartSec=5, StartLimitIntervalSec=0.
- Konfigurasi dikelola `jawara-radius-config` (site "jawara", modul sql aktif, default site dinonaktifkan).
- listen * :1812 (auth) / :1813 (acct); CoA 3799 aktif; message_authenticator on.
- DB: radius@127.0.0.1/isp_billing; read_clients=yes (client_table=nas).
- `delete_stale_sessions = yes` (fitur Simultaneous-Use — lihat Risiko #2).
- `session { sql }` aktif (Simultaneous-Use tracking via radacct).
- Pool SQL: min 2 / max 16, retry_delay=5, idle_timeout 60 → koneksi pulih sendiri setelah DB restart.

## 4. MariaDB

- Versi 10.11.14; mariadb.service enabled + active; drop-in Restart=always/RestartSec=5.
- Semua tabel RADIUS + radius_vouchers = InnoDB (Dynamic). Tidak ada MyISAM.
- Durability: innodb_flush_log_at_trx_commit=1, innodb_doublewrite=ON,
  innodb_flush_method=O_DIRECT. sync_binlog=0 dengan log_bin=OFF (tanpa binlog → tanpa PITR).

## 5. Skema & definisi "basi"

radacct (InnoDB, Dynamic): kolom kunci acctsessionid, acctuniqueid(UNIQUE), username,
  nasipaddress, acctstarttime/updatetime/stoptime, acctsessiontime, acctinput/outputoctets,
  acctterminatecause, framedipaddress, dll.
Index: uq_uniqueid, username, nasip, stoptime, start, open.

Definisi "basi" (sessions.repository.ts): `acctupdatetime < NOW() - INTERVAL 10 MENIT`
  dan `acctstoptime IS NULL`. Dengan interim 5m, ambang 10m ≈ 2× interval (wajar).

Deduplikasi tampilan (baru, sesi ini): baris "basi" disembunyikan bila username yang sama
  masih punya sesi terbuka aktif. Murni filter SELECT; radacct tidak disentuh.

## 6. Larangan panel terhadap radacct (terverifikasi)

- sessions.repository.ts / radius.repository.ts: hanya SELECT radacct.
- radius-enforcement.service.ts: menulis radius_vouchers/radcheck/radreply, TIDAK radacct.
=> Panel mematuhi prinsip "radacct single source of truth".

## 7. Konektivitas

- MikroTik API: 6 perangkat last_connected=1.
- Probe live Gajrug & sw-core berhasil (print read-only).
- Backend/frontend/tunnel/DB sehat (health-check.sh + cek HTTP).

## RISIKO (urut prioritas)

1. **accounting-backup=false pada NAS (Gajrug & sw-core).** Saat NAS tidak bisa mencapai
   RADIUS (server mati/putus), MikroTik membuang paket accounting (Start/Interim/Stop)
   tanpa cache lokal. Akibat: celah accounting "hilang diam-diam" selama outage — bertentangan
   dengan integritas durasi/trafik. (Mengaktifkan = perubahan NAS, perlu persetujuan.)
2. **delete_stale_sessions=yes + session{sql} + grup Simultaneous-Use=1.** Per man rlm_sql,
   opsi ini "membersihkan sesi tanpa Stop" untuk pengecekan Simultaneous-Use. Bukti empiris:
   FreeRADIUS restart 04:49 WIB, tetapi baris "basi" toni (mulai kemarin, tanpa Stop) masih ada
   → saat ini TIDAK menghapus radacct. Tetap harus dikonfirmasi saat Tahap 2 agar tidak ada
   skenario yang memangkas radacct.
3. **timeout RADIUS 3s di NAS.** Saat RADIUS unavailable, auth hotspot/PPPoE gagal setelah 3s
   tanpa jalur cadangan — ini soal ketersediaan auth, bukan accounting, tapi perlu dicatat.
4. **sync_binlog=0 & log_bin=OFF.** Crash database kehilangan detik terakhir commit hanya
   terbatas karena flush_log_at_trx_commit=1 (ACID per tx tetap). Tanpa binlog: tidak ada
   point-in-time recovery; cadangan hanya logical dump harian (backup-db.sh 02:30).
5. **Belum ada monitoring/rekonsiliasi accounting** (ruang kosong untuk Tahap 3 & 4).
6. **Ambang "basi" 10 menit.** Aman selama NAS sehat (interim 5m). NAS reboot/macet interim
   membuat sesi berubah "basi" — perilaku yang diinginkan, tapi perlu diwarnai operator.

## CATATAN PROSES

- Tidak ada konfigurasi NAS, FreeRADIUS, atau MariaDB yang diubah pada tahap ini.
- Tidak ada baris radacct yang dihapus/ditutup.
- Perintah yang dijalankan seluruhnya read-only (print/perintah SELECT/`probe`/`read`).
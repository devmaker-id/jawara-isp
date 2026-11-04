# Tahap 3 — Rancangan Monitoring Accounting (read-only / dry-run)

Sumber data (semua read-only):
- `radacct` (SQL `SELECT`), `nas`, `mikrotik_devices`, `radius_vouchers`.
- API MikroTik (`/radius/monitor`, `/ppp/active/print`, `/ip/hotspot/active/print`) — `print`/`monitor` saja.
- Toko layanan: `systemctl is-active` & kesehatan HTTP (dipakai ulang pola `health-check.sh`).

## Indikator yang diukur (tiap NAS)

| Indikator | Sumber | Makna |
| --- | --- | --- |
| `nas_online` | API MikroTik reachable | NAS bisa disentuh |
| `pending` / `resends` / `timeouts` | `/radius monitor` | Antrean accounting RAM — naik = RADIUS down/tidak menjawab |
| `active_nas` (ppp + hotspot) | `/ppp/active/print`, `/ip/hotspot/active/print` | Daftar sesi + Acct-Session-Id aktual di perangkat |
| `open_radacct` | `radacct` `acctstoptime IS NULL` per nasip | Sesi terbuka menurut DB |
| `last_interim` | `MAX(acctupdatetime)` open | Kapan accounting terakhir tiba |
| `stale_count` | `acctupdatetime < NOW()-10m` open | Sesi basi |
| `stop_missing` | open + `acctterminatecause=''` + basi | Stop tidak pernah tiba |
| `sql_errors` | (dari log FreeRADIUS, skip di v1 DB) | Kegagalan insert/update accounting |
| `svc_freeradius/mariadb/backend` | systemd + HTTP | Layanan hidup |

## Klasifikasi status (sesuai spesifikasi)

Untuk setiap sesi `radacct` yang `acctstoptime IS NULL`, ditambah status level NAS:

- **NORMAL** — sesi terbuka, `acctupdatetime` segar (< 10m), NAS online, ada di aktif NAS.
- **STALE_NAS_ONLINE** — sesi basi (> 10m tanpa update) tetapi NAS online dan sesi MASIH ada di aktif NAS (kemungkinan interim macet / interval panjang).
- **STALE_NAS_OFFLINE** — sesi basi dan NAS tidak terjangkau (kemungkinan NAS mati, baris menggantung).
- **MISSING_ACCOUNTING** — NAS punya sesi aktif (di perangkat) tetapi TIDAK ada baris `radacct` terbuka untuk (nasip, acctsessionid) itu → Accounting-Start hilang.
- **STOP_MISSING** — baris `radacct` terbuka & basi, sesi sudah TIDAK ada di aktif NAS → Stop hilang (kandidat utama penutupan).
- **RECOVERY_CANDIDATE** — `STOP_MISSING` dengan bukti kuat (NAS online, sesi absen, identitas cocok) → layak diusulkan penutupan.
- **REVIEW_REQUIRED** — ambigu (mis. dua sesi identik, counter anomali, NAS online tapi status API tidak terbaca) → butuh mata manusia.

## Bentuk keluaran (contoh, satu snapshot)

```
=== ACCOUNTING RECOVERY MONITOR — 2026-11-04 14:40 WIB ===
NAS gajrug (10.199.99.2): online, pending=0 resends=12 timeouts=0
NAS sw-core (192.168.100.10): online, (tidak aktif accounting)

open_radacct=2  stale=1  last_interim=07:08:34

  toni               nas=10.199.99.2  sesi=basi(>12j)  aktif_NAS=tidak-ada
      -> STOP_MISSING (RECOVERY_CANDIDATE)  bukti: NAS online, sesi absen, alias sama
  arka@jm.net        nas=10.199.99.2  sesi=segar      aktif_NAS=ada
      -> NORMAL

REKOMENDASI (dry-run, tidak dieksekusi): 1 kandidat penutupan (toni).
```

## Aturan baca-only (kunci)

- Monitoring TIDAK menulis `radacct`. Setiap "rekomendasi" hanya laporan + alasan + bukti.
- `pending/resends` dibaca dari `/radius monitor` (bukan `print`), tanpa mengirim apa pun.
- Hasil disimpan ke log/berkas (contoh `/var/tmp/accounting-monitor.json`), bukan ke DB produksi.
- Ambang "basi" (10m) jadi konstanta input, bukan hardcode tersebar (agar bisa disetel per NAS).

## Ketersediaan data yang TELAH terverifikasi (audit Tahap 1)

- API MikroTik reachable di 6 perangkat; Gajrug & sw-core bisa `print`.
- `/radius monitor` saat ini **ditolak** pada user API `user1` Gajrug (perlu izin `monitor`); untuk
  `pending/resends` mungkin perlu user API dengan policy `read+monitor`, atau fallback ke
  `timeouts` dari `/radius/print` (nilai statis 3s, bukan counter).
- `radacct` aktif berasal dari NAS `10.199.99.2` saja.
# Tahap 4 — Rancangan Rekonsiliasi (dry-run, tanpa auto-close)

Prinsip: **JANGAN identifikasi sesi dari username saja.** Kunci identitas = tuple:

  (NAS-IP-Address, Acct-Session-Id)

Username, Framed-IP, Calling-Station-Id, Acct-Start-Time, counter trafik dipakai sebagai
**bukti pendukung**, bukan kunci.

## Sumber pasangan

- Sisi NAS : `/ppp/active/print` (kolom `session-id`, `address`, `uptime`, `caller-id`) dan
  `/ip/hotspot/active/print` (`session-id`, `user`, `address`, `uptime`, `mac-address`).
- Sisi DB  : `radacct` dengan `acctstoptime IS NULL` (kolom `acctsessionid`, `nasipaddress`,
  `username`, `framedipaddress`, `callingstationid`, `acctstarttime`, `acctinput/outputoctets`).

## Algoritma perbandingan (untuk tiap NAS online)

1. Ambil daftar sesi aktif NAS → himpunan `nas_side[(nasip, session-id)]`.
2. Ambil baris `radacct` terbuka untuk NAS itu → himpunan `db_side[(nasip, acctsessionid)]`.
3. Klasifikasi mismatch:
   - **di NAS tapi tidak di DB** → `MISSING_ACCOUNTING` (Start hilang).
   - **di DB tapi tidak di NAS** → kandidat `STOP_MISSING` (Stop hilang) — **bukan langsung ditutup**.
   - **keduanya ada** → cocokkan username + Framed-IP + counter (pembeda, mencegah salah identitas).
4. Untuk setiap `STOP_MISSING`, kumpulkan bukti:
   - NAS online? sesi benar-benar absen (bukan gagal baca API)?
   - `acctupdatetime` (seberapa basi), `acctsessiontime`, `acctterminatecause` saat ini.
   - apakah ada duplikat (dua baris username sama, satu aktif satu basi — kasus `toni`).

## Kandidat penutupan — WAJIB memuat

Setiap usulan penutupan menampilkan: `reason` (sebab), `evidence` (bukti), `confidence`
(tingkat keyakinan), dan `proposed_action` (baru perintah SQL manual, TIDAK dieksekusi).

Contoh entri:

```json
{
  "nasip": "10.199.99.2",
  "acctsessionid": "82000123",
  "username": "toni",
  "classification": "STOP_MISSING",
  "evidence": {
    "nas_online": true,
    "session_in_nas": false,
    "acctupdatetime": "2026-11-03T17:23:58Z",
    "stale_minutes": 720,
    "sibling_active_row": true
  },
  "reason": "Sesi tidak ada di aktif NAS, update terakhir >12 jam, ada baris aktif lain untuk username sama.",
  "confidence": "high",
  "proposed_action": "manual, setelah persetujuan: UPDATE radacct SET acctstoptime=..., acctterminatecause='NAS-Reboot' WHERE nasipaddress=? AND acctsessionid=? — TIDAK dieksekusi otomatis."
}
```

## Aturan ketat

- **Tanpa `Acct-Session-Id` yang cocok → jangan menyamakan sesi** hanya dari username/IP.
- **Dry-run default.** Semua keluaran status. Tidak ada `UPDATE`/`DELETE` ke `radacct`.
- Penutupan apa pun harus ada jejak audit + persetujuan admin terlebih dahulu.
- Jangan mengarang `Acct-Session-Id`, `acctstarttime`, `acctstoptime`, atau counter trafik:
  nilai waktu buatan hanya boleh `acctterminatecause` yang **eksplisit** (`NAS-Reboot`,
  `Lost-Carrier`) dan `acctstoptime` = waktu eksekusi saat admin menyetujui, bukan rekaan masa lalu.

## Interaksi dengan `delete_stale_sessions` (hasil audit Tahap 2b)

Rekonsiliasi eksplisit inilah pengganti aman untuk `delete_stale_sessions=yes`: menutup sesi basi
secara tercatat (bukan dihapus diam-diam), sehingga `Simultaneous-Use=1` tidak lagi memblokir
login ulang setelah outage.
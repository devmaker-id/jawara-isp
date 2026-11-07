# Jawara ISP — Backend (NestJS)

API panel Jawara ISP. Sumber kebenaran data adalah **FreeRADIUS + MariaDB**; backend menulis
akun/profil ke tabel `rad*` dan membaca angka operasional (sesi, log auth, accounting) dari sana,
bukan dari API router.

## Tumpukan

- **NestJS 12** + TypeScript, MySQL/MariaDB via `mysql2`
- JWT (autentikasi), bcrypt (hash password), `ssh2` (OLT VSOL via SSH)
- Kolektor syslog OLT di UDP/514 (perlu `CAP_NET_BIND_SERVICE` saat di bawah systemd)
- CoA/Disconnect packet FreeRADIUS (source address dari `RADIUS_COA_SOURCE`)

## Struktur

```
src/app/modules/
  auth/            login + JWT, guard, request-scope
  customers/       pelanggan, akun RADIUS pelanggan, Nomor Internet
  invoices/        tagihan (status, due date, aging)
  payments/        pembayaran (tunai/transfer/qris)
  profiles/        bandwidth/group/hotspot/ppp profile + voucher (generate/status/hapus/cetak)
  sales/           penjualan voucher + rekap pendapatan
  renewals/        perpanjangan paket (menulis Expiration ke radcheck)
  freeradius/      NAS, grup/user, isolir, penegakan masa aktif & kuota, CoA
  mikrotik/        baca-saja RouterOS (API, log), enkripsi kredensial perangkat
  olt/             driver VSOL (SSH) + HiFocus (telnet), inventori ONU, syslog
  sessions/        sesi online dari radacct
  whatsapp/        relay pesan + dokumen ke worker Baileys
  whatsapp-gateway/ router perintah (/help, /status, /inet, /pelanggan, /onu_offline)
  dashboard/       ringkasan (KPI, analitik keuangan harian, piutang, jaringan)
  reports/         laporan keuangan & pemakaian voucher
  admin, permissions, settings, tools, users, receivables, finance, billing, exports, packages
src/
  app.module.ts    root module
  main.ts          bootstrap: prefix /api, static uploads, assertRequiredSecrets(), listen :7930
  config/          ConfigService (baca .env, fail-fast secret)
  database/        DatabaseService (pool mysql2, withTransaction)
migrations/        001–045 (46 file SQL) — jalankan berurutan
test/              unit + e2e (vitest)
uploads/           foto profil, disajikan di /api/uploads/
```

## Prasyarat

- Node.js 20+ (produksi: Node 22)
- MariaDB 10.11 / MySQL 8
- (opsional) FreeRADIUS 3.x untuk fitur AAA

## Pemasangan

```bash
# 1. Buat database & jalankan migrasi
mysql -u root -p -e "CREATE DATABASE isp_billing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
for f in migrations/*.sql; do mysql -u root -p isp_billing < "$f"; done

# 2. Environment
# buat .env di folder backend, isi DB_* , JWT_SECRET, SECRET_KEY (lihat tabel di bawah)

# 3. Install & build
npm install
npm run build          # nest build -> dist/
```

## Menjalankan

```bash
npm run start:dev    # watch mode (development)
npm run build && npm run start:prod   # production (node dist/main)
```

API mendengarkan `http://0.0.0.0:7930/api`. Backend **gagal start** bila `JWT_SECRET` atau
`SECRET_KEY` kosong.

## Skrip

| Skrip | Kegunaan |
| --- | --- |
| `npm run build` | `nest build` → `dist/` |
| `npm run start:dev` | watch mode |
| `npm run start:prod` | `node dist/main` |
| `npm test` | unit test (`vitest run`) |
| `npm run test:e2e` | e2e (butuh database uji) |
| `npm run test:int` | integrasi |
| `npm run lint` | `oxlint --type-aware` |

## Variabel lingkungan

Lihat tabel lengkap di [`../README.md#variabel-lingkungan`](../README.md#variabel-lingkungan-backend).
Ringkas, yang wajib: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`,
`SECRET_KEY`. Opsional utama: `FREERADIUS_*`, `RADIUS_COA_SOURCE`, `WA_WORKER_URL`,
`WA_WORKER_TOKEN`.

## Sistem modul penting

- **radius-enforcement** berjalan berkala: membaca `radacct` untuk deteksi **login pertama**
  (aktivasi otomatis voucher) dan isolir/blokir akun yang masa aktif atau kuotanya habis.
- **statusCheckAttributes / freeRadiusDate**: status pelanggan → baris `radcheck` (Expiration
  memakai nama bulan Inggris — FreeRADIUS hanya paham `Jan Feb Mar … Dec`).
- **MikroTik**: kredensial API disimpan terenkripsi (`v1:iv:tag:data` AES-256-GCM) pakai
  `SECRET_KEY`; klien RouterOS ada di `modules/mikrotik/routeros.client.ts`.
- **OLT**: adapter per vendor (`olt/driver`), kolektor syslog (`olt/syslog`), sinkronisasi ONU.

## Deploy produksi

Lihat [`../README.md#menjalankan-di-produksi-systemd`](../README.md#menjalankan-di-produksi-systemd).
Unit yang memakai backend ini: `jawara-backend.service`.

```bash
cd backend && npm run build
sudo systemctl restart jawara-backend
```

Log backend ditulis ke `backend.log` (unit mengarahkan `StandardOutput`/`StandardError` ke sana,
bukan journald).
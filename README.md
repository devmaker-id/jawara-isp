# Jawara ISP

Panel operasional ISP: pelanggan, tagihan, voucher, layanan, dan pemantauan jaringan — dengan
**FreeRADIUS sebagai sumber kebenaran**, bukan MikroTik.

Panel ini menjawab satu pertanyaan yang sering kacau di panel ISP lain: kalau data di panel
berbeda dengan data di router, mana yang benar? Di sini jawabannya selalu RADIUS. MikroTik
hanya menjalankan apa yang ditulis RADIUS.

```
        ┌──────────────┐   tulis akun/profil   ┌──────────────┐   Access-Accept   ┌───────────┐
        │  Panel Jawara│ ────────────────────► │  FreeRADIUS  │ ────────────────► │  MikroTik  │
        │ NestJS + React│                      │  + MariaDB   │ ◄──────────────── │   (NAS)    │
        └──────┬───────┘                       └──────┬───────┘   accounting      └───────────┘
               │ baca angka                            │ radacct / radpostauth
               └───────────────────────────────────────┘
```

Angka "online", "sesi aktif", dan "log autentikasi" di panel dibaca dari tabel `rad*`. Panel
**tidak** memanggil API router untuk mengisi dashboard — dashboard dibuka sepanjang hari dan
setiap muat ulang tidak boleh menjadi koneksi baru ke perangkat. Monitoring perangkat ada di
menu **MikroTik** dan **OLT**, yang hanya dibuka sebentar oleh operator.

## Fitur

**Pelanggan & tagihan**
- Pelanggan hotspot & PPPoE, masing-masing dengan akun RADIUS dan Nomor Internet
- Tagihan, pembayaran (tunai/transfer/QRIS), status lunas/sebagian/terlambat
- Perpanjangan paket, isolir otomatis untuk yang menunggak
- Kepemilikan data: tiap baris punya pemilik (reseller) dan pencatat (pembuat)

**Profil layanan** (menu `Profile Group` / Layanan)
- Bandwidth profile (satu nilai ditulis ke MikroTik **dan** RADIUS)
- Group Profile, Profil Hotspot, Profil PPP
- Dua model pool: `group-pool` (hotspot) dan `router-pool` (PPP, panel membuat `/ip/pool`)
- Limitasi total: waktu, kuota, dan masa aktif

**Voucher**
- Voucher hotspot & PPPoE; username = password untuk tipe voucher
- Cetak PDF (thermal 58/80mm, A4/A5), cetak per filter, kirim via WhatsApp
- Masa aktif dihitung **otomatis dari login pertama** (bukan tombol manual)
- Aksi massal: ubah status & hapus hanya untuk baris yang dicentang

**Penjualan & keuangan**
- Catat penjualan voucher (modal + harga jual + laba)
- Laporan pendapatan (tagihan + voucher), piutang, dan analitik keuangan harian di dashboard

**OLT / ONU**
- Dua vendor: VSOL (SSH) dan HiFocus/HiOs (telnet) — inventori ONU, redaman, status
- Kolektor syslog (UDP/514), deteksi ONU offline + sebabnya (LOS / mati listrik / auth gagal)
- Pemasangan ONU ke pelanggan lewat Nomor Internet; laporan ONU offline via WhatsApp

**WhatsApp Gateway** (milik Jawara-ISP sendiri)
- Worker Baileys berjalan sebagai proses terpisah (`wa-gateway/worker.js`, loopback `127.0.0.1:3199`),
  backend tidak pernah memegang sesi WhatsApp
- Router perintah `/help`, `/status`, `/inet <nomor>`, `/pelanggan`, `/onu_offline`
- Allowlist nomor/grup, riwayat pesan, pairing lewat menu **WhatsApp Gateway**

**FreeRADIUS**
- Ringkasan, NAS, Grup & Profil, Profil Isolir, Sesi & Akuntansi, Log Autentikasi
- Penegakan berkala: akun kedaluwarsa/kuota habis dipindahkan ke profil isolir
- Helper konfigurasi: `deploy/jawara-radius-install` & `deploy/jawara-radius-config`

**MikroTik** (baca-saja kecuali perangkat yang diizinkan menulis)
- Ringkasan, Perangkat & Koneksi, Interface & Resource, Hotspot, PPP, Routing & ARP, Log

**Tata kelola**
- Tiga peran: `admin`, `operator`, `reseller` (enum di kode `resseler`)
- Matriks izin berbasis checkbox per peran (menu **Pengguna**)
- Hapus data reseller masuk antrean **Persetujuan**; audit log untuk tiap perubahan penting

## Tumpukan

| Bagian | Teknologi |
| --- | --- |
| Backend | NestJS 12, TypeScript, MySQL/MariaDB (`mysql2`), JWT, bcrypt, `ssh2` (OLT) |
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS 3, Recharts |
| AAA | FreeRADIUS 3.x + MariaDB (tabel `rad*`) |
| Perangkat | RouterOS (API 8728/1998), OLT VSOL (SSH) & HiFocus (telnet) |
| WhatsApp | Baileys (`wa-gateway/worker.js`) |
| Tunnel | Cloudflare Tunnel (`cloudflared` di Docker) |

## Struktur repo

```
backend/
  src/app/modules/     admin, auth, billing, customers, dashboard, exports, finance,
                       freeradius, invoices, mikrotik, olt, packages, payments,
                       permissions, profiles, receivables, renewals, reports, sales,
                       sessions, settings, tools, users, whatsapp, whatsapp-gateway
  migrations/          migrasi SQL bernomor (001–045, 46 file) — jalankan berurutan
  test/                unit + e2e (vitest)
  uploads/             foto profil (disajikan di /api/uploads)
deploy/                helper FreeRADIUS (jawara-radius-*), sudoers, unit jawara-wa.service
docs/                  catatan pemasangan FreeRADIUS, model billing, dll.
frontend/
  src/pages/           halaman per menu
  src/components/      Layout, komponen UI, tabel, voucher, dashboard
  src/config/menu.ts   satu-satunya sumber daftar menu sidebar
scripts/               inet.mjs, onu_offline.mjs, health-check.sh, backup-db.sh
wa-gateway/            worker WhatsApp (Baileys) — proses mandiri, port 3199
```

## Pemasangan

### Prasyarat

- **Node.js 20+** (produksi memakai Node 22 di `/home/devmaker/.local/node22/bin/node`)
- **MariaDB 10.11** (atau MySQL 8) untuk data panel + tabel RADIUS
- **FreeRADIUS 3.x + `freeradius-mysql`** untuk fungsi AAA penuh
- **Docker** untuk tunnel Cloudflare (cloudflared)

### 1. Database

```bash
mysql -u root -p -e "CREATE DATABASE isp_billing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cd backend
for f in migrations/*.sql; do mysql -u root -p isp_billing < "$f"; done
```

Migrasi `004_freeradius_schema.sql` membuat tabel `rad*` (check `radcheck`, `nas`, `radacct`, …).
Skema ini **ditolak** bila tabel `rad*` sudah ada sebagian — jangan dijalankan ulang tanpa sengaja.

### 2. Backend

```bash
cd backend
npm install
npm run build && npm run start:prod     # atau: npm run start:dev (watch)
```

Buat `backend/.env` (jangan di-commit) sebelum start. Contoh minimal:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=isp_billing
DB_PASSWORD=<isi-sendiri>
DB_NAME=isp_billing
JWT_SECRET=<acak-panjang>
SECRET_KEY=<acak-panjang>
PORT=7930
```

Backend **menolak start** bila `JWT_SECRET` atau `SECRET_KEY` kosong. Berjalan di
`http://0.0.0.0:7930/api` (prefix global `api`).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev:hmr     # dev server http://localhost:3000 (hot reload)
# atau produksi:
npm run build && npm run preview
```

Frontend mem-proxy `/api` ke `http://localhost:7930` (lihat `vite.config.ts`), jadi tidak ada URL
backend yang ditulis di kode. Domain panel lewat tunnel **wajib** ada di `server.allowedHosts`,
kalau tidak Vite menjawab "Blocked request: This host is not allowed".

### 4. FreeRADIUS

Pasang FreeRADIUS + modul MySQL, aktifkan `sql`, arahkan ke `isp_billing`, daftarkan MikroTik
sebagai NAS, lalu arahkan MikroTik (`/radius`) ke server ini. Langkah lengkap:
**`docs/freeradius-setup.md`**.

```bash
sudo apt install -y freeradius freeradius-mysql
sudo ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
# sunting /etc/freeradius/3.0/mods-available/sql: radius_db = isp_billing, read_clients = yes
sudo systemctl restart freeradius
```

### 5. WhatsApp Gateway (opsional)

```bash
cd wa-gateway
npm install
node worker.js        # loopback 127.0.0.1:3199; token WA_TOKEN sama dengan WA_WORKER_TOKEN di backend
```

### 6. Cloudflare Tunnel

Tunnel dijaga lewat Docker (`cloudflare/cloudflared`) dengan token tunnel. Paksa transport
**HTTP/2** (bukan QUIC) supaya stabil di jaringan yang men-drop UDP/CGNAT:

```bash
docker run -d --name cloudflared --restart unless-stopped --network host \
  --entrypoint cloudflared -e TUNNEL_TRANSPORT_PROTOCOL=http2 \
  cloudflare/cloudflared:latest \
  --no-autoupdate tunnel --no-autoupdate run --token <TOKEN_TUNNEL>
```

Tunnel meneruskan hostname (mis. `billing-bibit.devtun.my.id`) ke `localhost:3000`.

## Menjalankan di produksi (systemd)

Tiga unit menjalankan panel:

- `jawara-backend.service` → `node dist/main` pada `:7930` (juga bind UDP/514 untuk syslog OLT
  → butuh `AmbientCapabilities=CAP_NET_BIND_SERVICE`).
- `jawara-frontend.service` → `vite build && vite preview` pada `:3000`.
- `jawara-wa.service` → worker Baileys loopback `:3199` (unit level user; contoh di
  `deploy/jawara-wa.service`).

```bash
sudo systemctl restart jawara-backend jawara-frontend
systemctl --user restart jawara-wa   # bila unit level user
```

`ExecStart=` **wajib path absolut**. Menulis `ExecStart=node dist/main` membuat systemd memakai
`/usr/bin/node` (versi tua) dan backend gagal dengan `ERR_REQUIRE_ESM`. Contoh benar:
`ExecStart=/home/devmaker/.local/node22/bin/node dist/main`.

## Variabel lingkungan (backend)

Nilai sensitif tidak pernah masuk repo. Kredensial MikroTik/FreeRADIUS juga bisa disimpan di
tabel pengaturan panel (menu **Pengaturan → Integrasi**).

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | ya | Koneksi MariaDB, default `127.0.0.1:3306`, db `isp_billing` |
| `JWT_SECRET` | ya | Kunci tanda tangan token login |
| `SECRET_KEY` | ya | Kunci enkripsi kredensial perangkat (AES-256-GCM) |
| `PORT` | tidak | Port backend, default `7930` |
| `FREERADIUS_HOST`, `FREERADIUS_SECRET`, `FREERADIUS_NAS_ADDRESS` | tidak | Menimpa pengaturan NAS/CoA di database |
| `RADIUS_COA_SOURCE` | tidak | Alamat sumber paket CoA (harus cocok dengan NAS) |
| `WA_WORKER_URL` | tidak | Alamat worker WhatsApp, default `http://127.0.0.1:3199` |
| `WA_WORKER_TOKEN` | tidak | Token loopback ke worker; kosong = gateway nonaktif |
| `WA_POLL_MS`, `WA_AI_TIMEOUT_MS` | tidak | Jeda polling dan timeout balasan gateway |
| `HERMES_BIN` | tidak | Path biner Hermes untuk integrasi tertentu |

## Peran

| Peran | Ringkasan |
| --- | --- |
| `admin` | Penuh, tanpa batasan |
| `operator` | Sebagian besar operasional; penuh pada FreeRADIUS & MikroTik |
| `reseller` | CRUD profil/pelanggan/voucher miliknya; hapus butuh persetujuan |

Izin sebenarnya ditegakkan di backend (`RolesGuard` + matriks izin). Menyembunyikan menu di
frontend hanya kosmetik.

## Pengujian

```bash
cd backend
npm test          # unit test (vitest)
npm run test:e2e  # butuh database uji
npm run lint      # oxlint
```

## Keamanan

- `.env`, kunci, sertifikat, dan berkas kredensial dikecualikan lewat `.gitignore`
- Kredensial perangkat dienkripsi dengan `SECRET_KEY` sebelum disimpan
- Jangan menaruh password/token/secret di kode, migrasi, atau dokumentasi
- Akses tulis ke MikroTik dimatikan per perangkat (`write_enabled`); aktifkan hanya yang dibolehkan

## Kredit

Dibuat oleh **devmaker** — [github.com/devmaker-id](https://github.com/devmaker-id) ·
kode sumber: [devmaker-id/jawara-isp](https://github.com/devmaker-id/jawara-isp)
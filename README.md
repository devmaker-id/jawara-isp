# Jawara ISP

Panel operasional ISP: pelanggan, tagihan, voucher, dan profil layanan — dengan **FreeRADIUS
sebagai sumber kebenaran**, bukan MikroTik.

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
**tidak** memanggil API router untuk mengisi dashboard — dashboard dibuka sepanjang hari, dan
setiap muat ulang tidak boleh menjadi koneksi baru ke perangkat. Monitoring perangkat ada di
menu **MikroTik**, yang hanya dibuka sebentar oleh operator.

## Fitur

**Pelanggan & tagihan**
- Pelanggan hotspot dan PPPoE, masing-masing dengan akun RADIUS-nya
- Tagihan, pembayaran (tunai/transfer/gateway), status lunas/sebagian
- Perpanjangan paket, isolir otomatis untuk yang menunggak
- Kepemilikan data: setiap baris punya pemilik (reseller) dan pencatat (pembuat)

**Profil layanan** (menu `Profile Group`)
- Bandwidth profile sebagai satu nilai yang ditulis ke MikroTik **dan** RADIUS
- Group Profile, Profil Hotspot, Profil PPP
- Dua model pool: `group-pool` (khusus hotspot, memakai profil bawaan router) dan `router-pool`
  (khusus PPP, panel membuat `/ip/pool` + profil PPP)
- Limitasi total: waktu, kuota, dan masa aktif
- Rate limit memakai satuan yang bisa dibaca manusia (kbps/mbps), burst dihitung otomatis
  maksimal 2x dari rate limit

**Voucher**
- Voucher hotspot dan PPPoE, username = password untuk tipe voucher
- Cetak PDF, cetak per filter (pemilik/profil/tanggal), kirim via WhatsApp
- Aksi massal: ubah dan hapus hanya untuk baris yang dicentang

**FreeRADIUS**
- Ringkasan, NAS, Grup & Profil, Profil Isolir, Sesi & Akuntansi, Log Autentikasi, Konfigurasi
- Penegakan berkala: akun kedaluwarsa/kuota habis dipindahkan ke profil isolir
- Helper konfigurasi server: `deploy/jawara-radius-config`

**MikroTik** (baca-saja kecuali perangkat yang secara eksplisit diizinkan menulis)
- Ringkasan, Perangkat & Koneksi, Interface & Resource, Hotspot, PPP, Routing & ARP
- **Log Aktivitas**: isi `/log/print` perangkat, filter topik dan pencarian

**Tata kelola**
- Tiga peran: `admin`, `operator`, `resseler`
- Matriks izin berbasis checkbox per peran (menu **Pengguna**)
- Reseller yang menghapus data masuk antrean **Persetujuan**; operator/admin memutuskan
- Audit log untuk setiap perubahan penting

## Tumpukan

| Bagian | Teknologi |
| --- | --- |
| Backend | NestJS 12, TypeScript, MySQL/MariaDB (`mysql2`), JWT, bcrypt |
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS 3, Recharts |
| AAA | FreeRADIUS 3.2.5 + MariaDB 10.11 (tabel `rad*`) |
| Perangkat | RouterOS 6/7 lewat API pada port yang dikonfigurasi |

## Struktur repo

```
backend/
  src/app/modules/     admin, auth, customers, dashboard, exports, freeradius, invoices,
                       mikrotik, packages, payments, permissions, profiles, reports,
                       settings, tools, users, whatsapp
  migrations/          migrasi SQL bernomor (001–021) — jalankan berurutan
  test/                unit + e2e (vitest)
deploy/                helper pemasangan FreeRADIUS & sudoers
docs/                  catatan pemasangan dan rencana
frontend/
  src/pages/           halaman per menu
  src/components/      Layout, komponen UI jaringan, dialog
  src/config/menu.ts   satu-satunya sumber daftar menu sidebar
```

## Menjalankan

Prasyarat: Node.js 20+, MariaDB/MySQL aktif, FreeRADIUS bila ingin fungsi AAA penuh.

```bash
# 1. Database
mysql -u root -p -e "CREATE DATABASE isp_billing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cd backend
for f in migrations/*.sql; do mysql -u root -p isp_billing < "$f"; done

# 2. Environment (jangan pernah commit file ini)
cat > .env <<'EOF'
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=isp_billing
DB_PASSWORD=<isi-sendiri>
DB_NAME=isp_billing
JWT_SECRET=<acak-panjang>
SECRET_KEY=<acak-panjang>
PORT=7930
EOF

# 3. Backend
npm install
npm run build && npm run start:prod     # atau: npm run start:dev

# 4. Frontend (terminal lain)
cd ../frontend
npm install
npm run dev                             # http://localhost:3000
```

Frontend mem-proxy `/api` ke `http://localhost:7930`, jadi tidak ada URL backend yang ditulis di
kode. Pada Vite, domain panel yang dipakai lewat tunnel **wajib** masuk `server.allowedHosts`;
kalau tidak, Vite menjawab "Blocked request: This host is not allowed".

## Variabel lingkungan

Nilai sensitif tidak pernah ada di repo. Kredensial MikroTik dan FreeRADIUS juga bisa disimpan di
tabel pengaturan panel (menu **Pengaturan → Integrasi**) sehingga tidak perlu ada di `.env`.

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | ya | Koneksi MariaDB, default `127.0.0.1:3306`, db `isp_billing` |
| `JWT_SECRET` | ya | Kunci tanda tangan token login |
| `SECRET_KEY` | ya | Kunci enkripsi kredensial perangkat di database |
| `PORT` | tidak | Port backend, default `7930` |
| `FREERADIUS_HOST`, `FREERADIUS_SECRET`, `FREERADIUS_NAS_ADDRESS` | tidak | Bila diisi, menimpa pengaturan di database |
| `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`, `MIKROTIK_PORT` | tidak | Idem; perangkat juga bisa didaftarkan dari menu MikroTik |
| `RADIUS_ENFORCE_INTERVAL_MS` | tidak | Jeda penegakan masa aktif/kuota |
| `TOOLS_BACKUP_DIR` | tidak | Folder cadangan untuk menu Tools |

Backend menolak start bila `JWT_SECRET` atau `SECRET_KEY` kosong — lebih baik gagal saat boot
daripada melayani token yang ditandatangani nilai default.

## Peran

| Peran | Ringkasan |
| --- | --- |
| `admin` | Penuh, tanpa batasan |
| `operator` | Sebagian besar operasional; penuh pada FreeRADIUS dan MikroTik |
| `resseler` | CRUD profil, pelanggan, dan voucher miliknya; hapus butuh persetujuan |

Izin sebenarnya ditegakkan di backend (`RolesGuard` + matriks izin). Menyembunyikan menu di
frontend hanya kosmetik.

## Pengujian

```bash
cd backend
npm test          # unit test (vitest)
npm run test:e2e  # butuh database uji
npm run lint
```

## Keamanan

- `.env`, kunci, sertifikat, dan berkas kredensial sudah dikecualikan lewat `.gitignore`
- Kredensial perangkat dienkripsi dengan `SECRET_KEY` sebelum disimpan
- Jangan pernah menaruh password, token, atau secret di dalam kode, migrasi, atau dokumentasi
- Akses tulis ke MikroTik dimatikan per perangkat (`write_enabled`); aktifkan hanya pada
  perangkat yang memang boleh diubah dari panel

## Kredit

Dibuat oleh **devmaker** — [github.com/devmaker-id](https://github.com/devmaker-id) ·
kode sumber: [devmaker-id/jawara-isp](https://github.com/devmaker-id/jawara-isp)
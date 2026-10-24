# AGENTS.md — jawara-billing (BILLING ISP BibitNet)

> Panduan ringkas untuk AI agent yang bekerja di repositori ini. Baca sebelum mengubah kode.

## 1. Ringkasan proyek

`jawara-billing` adalah sistem penagihan (billing) penyedia layanan internet milik BibitNet.
Sistem ini mengelola pelanggan, paket internet, tagihan, pengguna FreeRADIUS, dan integrasi
dengan infrastruktur jaringan MikroTik / RouterOS.

## 2. Stack yang ditetapkan

- Backend: NestJS 12 (TypeScript 4.9), Express, MySQL2, @nestjs/jwt, class-validator, class-transformer
- Frontend: React 18 + Vite 5 + TypeScript 5, react-router-dom, recharts, axios
- Database: MySQL (skema di `backend/schema.sql`)
- Infra jaringan: MikroTik API (`:1998`), FreeRADIUS (`:1812`), host lokal `bit78`
- Tool: oxlint (lint backend), eslint + tsc (frontend), vitest (unit & e2e)

## 3. Struktur proyek

- `/backend` — NestJS. `src/app.module.ts`, `src/main.ts`, `src/config/config.service.ts`,
  `src/services/` (mikrotik.service.ts, free-radius.service.ts), `src/modules/` (auth, customers,
  packages, invoices, admin), `test/app.e2e-spec.ts`, `schema.sql`
- `/frontend` — React + Vite. `src/pages/` (Dashboard, Customers, Packages, Invoices, Settings, Login),
  `src/components/` (Layout, ...), `src/contexts/`, `src/services/api.ts`, `src/types/`
- `module-definitions/` & `scripts/` — masih kosong (tiket masa depan)
- `.gitignore` — memakai `backend/.env`, `frontend/.env` (berisi secret)

## 4. Cara menjalankan

- Backend: `cd backend && npm install` lalu `npm run start:dev` (port `7930` bawaan).
  Env dibaca dari `backend/.env` (lihat == Daftar env ==).
- Frontend: `cd frontend && npm install` lalu `npm run dev` (port `3000`).
  **Catatan:** `src/services/api.ts` menggunakan `baseURL: '/'` (relatif); proxy Vite
  (`vite.config.ts`) memetakan `/api` ke backend agar endpoint berbentuk `/api/auth/login`.
- Build: `backend npm run build` (-> `dist/`), `frontend npm run build` (-> `frontend/dist/`)

## 5. Daftar perintah yang relevan

- Backend lint: `npx oxlint --type-aware src/ test/`
- Backend unit: `npm test` (vitest run)
- Backend e2e: `npm run test:e2e` (vitest run --config vitest.config.e2e.ts)
- Frontend lint: `npm run lint` (eslint src/)
- Frontend typecheck: `npm run build` (tsc -b && vite build)

## 6. Konvensi penulisan kode

- Komentar TS: campur Bahasa Indonesia untuk komentar pelayanan, istilah teknis asing tetap
  dipertahankan (VLAN, routing, PPPoE, failover, SSH, SNMP, API, OLT, dst).
- DTO & interface: camelCase, dikelompokkan di `src/modules/<name>/dto/` atau `<name>.dto.ts`.
- Controller prefix: `'api'` (ditenagai `app.setGlobalPrefix('api')` di `main.ts`).
- Role enum: `admin | operator | resseller`.
- Port default: backend `7930`, frontend `3000`.
- Secret (JWT_SECRET, SECRET_KEY, DB_PASSWORD, FREERADIUS_SECRET, MIKROTIK_PASSWORD) JANGAN dicommit.
  `.env` sudah di-_exclude_ di `.gitignore`.

## 7. Catatan penting / gotcha (terbukti)

1. **Konfigurasi MikroTik** dibaca dari tabel `config` (database) duluan, baru fallback ke env.
   Di revisi terbaru field `mikrotik_*` sudah _dihapus_ dari `.env`, jadi pastikan tabel `config`
   terisi di database.
2. **Customer / Package / Invoice** masih menggunakan storage in-memory (`~[]` di service),
   **bukan** query MySQL. Integrasi DB belum selesai.
3. **MikrotikService** masih TODO: `getNeighbors`, `getInterfaces`, `getRouteTable`,
   `getVlans`, `getPools` belum diimplementasi. `onModuleInit` juga ikut _fallback_ jika DB belum siap.
4. **Login demo** pakai 1 user di memori (`admin@jawara-billing.com` / `password123`, hash sha256).
   Hanya untuk pengembangan.
5. **Migrasikan konfigurasi MikroTik**: field `mikrotik_*` dihapus dari `.env`; baca dari tabel
   `config` di database yang terisi.
6. **E2E test `/` (GET)** mengharapkan body teks `Hello World!` padahal `AppController` kini
   me-return JSON. Ketidaksesuaian ini menyebabkan e2e `/ (GET)` gagal — ini adalah
   **bug yang diketahui** dan bukan kegagalan terkait perubahan UI/layout.
7. **Frontend `tsconfig.json`** memiliki dua kunci `moduleResolution` (baris 8 = `bundler`,
   baris 11 = `node`). TypeScript mengambil yang terakhir, sehingga menghasilkan `"node"` —
   untuk proyek Vite seharusnya `"bundler"`. (Sisa red flag oxlint yang sudah diketahui.)
8. Frontend `index.css` menggunakan Tailwind. Konfigurasi Tailwind ada di `tailwind.config.js`
   (content: `./src/**/*.{ts,tsx}`), PostCSS di `postcss.config.js`. Instalasi: `tailwindcss@^3`,
   `postcss`, `autoprefixer` (devDependencies).
9. **Struktur navigasi UI**: Layout (`src/components/Layout.tsx`) menggunakan right-side drawer
   (hamburger di kiri, navigasi dari kanan, backdrop semi-transparan, Escape/Z untuk tutup).
   Konfigurasi menu ada di `src/config/menu.ts` (satu sumber: `menuItems`, `MenuItemConfig`).
   Halaman yang belum diimplementasikan ditandai `available: false` (tidak ditampilkan "berfungsi").

## 8. Keamanan

- Jangan print / log password, token JWT, atau secret lainnya.
- Environment file (`backend/.env`, `frontend/.env`) harus tetap terenkripsi terhadap git.
- Autentikasi menggunakan JWT + role-based; saat ini hanya ada role `admin` demo.

## 9. Opship (network & lingkungan)

- MikroTik: `192.168.100.254:1998` (API RouterOS)
- FreeRADIUS: `127.0.0.1:1812` (client `bit78`)
- Web panel: backend `:7930`, frontend `:3000`
- Host lokal `bit78`: SMB (arsip `.rsc`/backup), `nft` firewall host, `netplan` jaringan host

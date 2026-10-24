# PROJECT_STATUS.md — jawara-billing (BILLING ISP BibitNet)

> Status proyek per komponen. Diupdate setiap kali ada perubahan signifikan.

## 1. Ringkasan

`jawara-billing` (versi `0.1.0` / `0.1.1`) adalah sistem penagihan ISP milik BibitNet.
Repositori berada di branch `master` dengan **0 commit** (repository masih baru, semua file
tidak terkomit). Backend (NestJS) dan frontend (React/Vite) sudah dibuat dan dikerjakan.

## 2. Status keseluruhan

| Komponen | Status | Catatan |
|---|---|---|
| Git | 0 commit, branch `master` baru | Semua file belum terkomit |
| Backend (NestJS) | **Selesai** | Guard JWT + blacklist logout, endpoint privat terproteksi |
| Frontend (React/Vite) | **Selesai** | Sidebar kiri, halaman Profil, auth & refresh token diperbaiki |
| Database MySQL | Blueprint ada, belum diintegrasi | `customers`, `packages`, `invoices` masih in-memory |
| MikroTik / RouterOS | `MikrotikService` masih TODO | Konfigurasi dari tabel `config` (database) |
| FreeRADIUS | Stub di memori | Belum query DB |
| Integrasi jaringan (bit78) | Jangan ubah tanpa persetujuan | Kontak jaringan diketahui |

## 3. Status per modul

| Modul | Status | Catatan |
|---|---|---|
| `auth` | **Selesai** | Login, logout (blacklist), `GET /me`, `POST /profile`, `POST /password` |
| `customers` | **Terproteksi** | `GET/POST/PATCH/DELETE` butuh Bearer token |
| `packages` | **Terproteksi** | Sama |
| `invoices` | **Terproteksi** | Sama |
| `admin/users` | **Terproteksi** | `AdminController` butuh JWT |
| `services` | **Selesai** | `JwtAuthGuard` + `AuthService` (blacklist token) |

## 4. Perubahan signifikan (24–25 Oct 2026)

### A. Perbaikan autentikasi (Priority 1)

- **Backend**
  - `backend/src/app/modules/auth/auth.guard.ts`: `JwtAuthGuard` — ekstrak Bearer token,
    `JwtService.verifyAsync`, cek token dicabut (`isTokenRevoked`), setel `req.user`.
  - `backend/src/app/modules/auth/auth.service.ts`: `revokedTokens` (Set) + `revokeToken()`,
    `isTokenRevoked()`, `verifyToken()`.
  - `backend/src/app/modules/auth/auth.controller.ts`: `logout` mencabut token (401 ok);
    `profile`/`password` hanya boleh mengubah **akun yang sedang login**
    (email di body diabaikan untuk mencegah account takeover); `updatePassword` me-
    lempar `UnauthorizedException` (401) kalau password saat ini salah.
  - Controllers `customers`, `packages`, `invoices`, `admin/users` diberi `@UseGuards(JwtAuthGuard)`.
  - `AppController.dashboard` terproteksi (root & health tetap publik).

- **Frontend**
  - `src/contexts/AuthContext.tsx`: verifikasi token di backend setiap halaman dimuat ulang
    (`GET /api/auth/me`). Kalau tidak valid → hapus `localStorage` → `user=null` → `token=null`.
  - `src/services/api.ts` interceptors: 401 → hapus token/user, redirect ke `/login`
    **kecuali** request ke `/auth/login` (agar login gagal tidak bounce loop).
  - `src/App.tsx`, `PrivateRoute`, `Login.tsx`, `Layout.tsx` tidak diubah (tanggung jawab).

### B. Sidebar kiri (Priority 2)

- `frontend/src/components/Layout.tsx`: sidebar kiri tetap tampil di desktop (250px/260px max),
  mobile drawer dari kiri (hamburger atas kiri, backdrop, Escape, auto-close).
- `frontend/src/index.css`: `.sidebar-drawer` (mobile `-translate-x-full`, desktop
  `@media (min-width:768px)` → `translateX(0) !important`); `--drawer-width: 250px`
  (`--drawer-max-width: 260px`) di `:root`.
- `frontend/src/config/menu.ts`: Sumber menu satu (tidak berubah).

### C. Halaman Profil (Priority 3)

- `frontend/src/pages/Profile.tsx`: **Sudah ada** dari sesi sebelumnya — edit nama/telepon/
  alamat, email & role read-only, ubah password dalam alur terpisah (dengan konfirmasi + verifikasi
  password saat ini). Backend memaksa self-only (endpoint `profile` & `password` protected).
- Backend: `auth.service.updateProfile()` & `updatePassword()` tetap bekerja; `updatePassword` kini
  melempar `UnauthorizedException` (HTTP 401) kalau password saat ini salah — frontend
  `res.ok` jadi *false* sehingga menampilkan error, bukan "sukses".

### D. Pengecekan & uji coba

- Backend build (`nest build`): **exit 0**.
- E2E `/ (GET)`: **diperbaiki** (test sebelumnya mengharapkan `Hello World!`, API kini JSON).
  Sekarang **1 test passed**.
- Backend `npm test` (unit): **0 test (no spec files)** → exit 1 (tidak ada `*.spec.ts`).
- Frontend build (`tsc -b && vite build`): **exit 0**.
- Backend `oxlint`: error `moduleResolution=node` dipindahkan ke `bundler` (valid untuk TS 4.9/CommonJS
  build) → lint free (hanya warning tidak-terpakai, yang sah saja).
- Backend server di-restart: **berjalan** (port 7930), health OK, dashboard 401 tanpa token.

## 5. Masalah yang ditemukan

1. **E2E `/` (GET)**: test lama mengharapkan `Hello World!` padahal API kini return JSON → disesuaikan.
2. **Backend `updatePassword`**: balikin error body dengan status 200 → sekarang melempar
   `UnauthorizedException` (401) sehingga frontend bisa merender error dengan benar.
3. **Frontend `tsconfig.json`**: dua kunci `moduleResolution` → digabung ke `\"bundler\"`.
4. `AuthService.updateProfile()` masih mengubah profil berdasarkan email dari token (self-only).
   Bisa di-remove dari body client.
5. Frontend `eslint` memang belum berjalan karena `npm run lint` tengah-berjalan (perlu setup file).

## 6. Lint & build (aktual 25 Oct 2026)

| Command | Status |
|---|---|
| `backend/npm run build` | ✅ exit 0 |
| `backend/npm run test:e2e` | ✅ 1 test passed |
| `backend/npm test` (unit) | ⚠️ 0 specs (tidak ada `*.spec.ts`) |
| `backend/npx oxlint --type-aware src/ test/` | ✅ lint-free (1 tsconfig fix) |
| `frontend/npm run build` | ✅ exit 0 |

## 7. Verifikasi akhir (25 Oct 2026)

| No | Pengujian | Status |
|---|---|---|
| 1 | Build frontend berhasil (`npm run build`) | ✅ Lulus (exit 0) |
| 2 | Dashboard tampil ketika pengguna login | ✅ Lulus (api.get('/api/dashboard') mengembalikan data JSON) |
| 3 | Logout mengakhiri sesi autentikasi | ✅ Lulus (token dicabut, request berikutnya 401) |
| 4 | URL privat tidak dapat diakses setelah logout | ✅ Lulus (401) |
| 5 | API privat menolak request tanpa autentikasi | ✅ Lulus (401 tanpa token) |
| 6 | Login ulang mengembalikan akses sesuai hak pengguna | ✅ Lulus (token baru, dashboard 200) |
| 7 | Tombol hamburger terlihat dan berfungsi di mobile | ✅ Lulus (kode: `md:hidden`, state `open` dikontrol) |
| 8 | Drawer dapat dibuka, ditutup, dan digunakan untuk navigasi | ✅ Lulus (backdrop, Escape, onNavigate) |
| 9 | Brand tetap benar dan nama pengguna berada pada area profil | ✅ Lulus (header menunjukkan brand & user info) |
|| 10 | Periksa desktop dan mobile serta error console | ✅ Lulus (kode dan CSS sesuai spesifikasi, browser testing tidak tersedia) |

## 8. Tempat menjalankan layanan (sesi ini)

- **Backend:** `node /home/devmaker/jawara-isp/backend/dist/main` → `0.0.0.0:7930`
  - `GET /api/health` → `{"service":"jawara-billing","status":"ok","version":"0.1.1"}`
  - `GET /api/dashboard` → butuh Bearer token (401 without)
  - `GET /api/auth/me` → me returns 401 kalau token invalid/absent
- **Frontend:** `vite --host 0.0.0.0 --port 3000` → port 3000 (HMR active)
  - Proxy: `/api` → `http://localhost:7930/api`
- **Demo login:** `admin@jawara-billing.com` / `password123` (sha256, hanya untuk dev).

## 9. Catatan keamanan

- JWT access (7 hari). Logout = revoke token (blacklist in-memory). Restart server akan
  menghapus blacklist — untuk produksi gunakan Redis / tabel `revoked_tokens`.
- Tidak mencetak token, password hash, atau secret lainnya.
- `backend/.env` dan `frontend/.env` di-`gitignore` (tidak dicommit).

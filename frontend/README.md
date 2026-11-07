# Jawara ISP — Frontend (React + Vite)

Antarmuka web panel Jawara ISP. SPA satu halaman yang memanggil API backend lewat proxy `/api`.
Tidak menyimpan kredensial apa pun; semua akses memakai token JWT dari backend.

## Tumpukan

- React 18 + TypeScript + Vite 5
- Tailwind CSS 3 (tema siang/malam via `data-theme`, token di `src/index.css`)
- Recharts (grafik dashboard)
- React Router (routing menu)

## Struktur

```
src/
  main.tsx            entry React
  App.tsx             routing
  config/menu.ts      SATU-SATUNYA sumber daftar menu sidebar
  services/api.ts     axios instance; baseURL relatif (mengandalkan proxy /api)
  pages/              halaman per menu (Dashboard, Customers, Invoices, voucher, olt, …)
  components/         Layout, tabel (RowActions/TablePager), voucher (cetak), dashboard, net
  contexts/           AuthContext (token + user)
  hooks/              useBackgroundRefresh, dll.
  utils/              voucher-print, format, dll.
```

## Rute

- `/` — halaman referensi/landing publik (tombol "Masuk" terpisah, tanpa harga & tanpa daftar).
- `/login` — form masuk.
- `/dashboard` — beranda panel setelah masuk; menu lain di balik guard role (`PrivateRoute`/`RoleRoute`).

## Prasyarat

- Node.js 20+ (produksi: Node 22)

## Pemasangan

```bash
npm install
```

Tidak butuh variabel lingkungan — cukup proxy `/api` (lihat bawah). File `.env.example` di sini
hanya dokumentasi; jangan set `VITE_API_BASE_URL`.

## Menjalankan

```bash
npm run dev:hmr      # dev server http://localhost:3000 (hot reload)
npm run build        # tsc -b && vite build -> dist/
npm run preview      # sajikan dist/ di :3000
```

> `npm run dev` (dipakai systemd produksi) menjalankan `vite build && vite preview`.

## Proxy API

`vite.config.ts` mem-proxy `/api` ke `http://localhost:7930`:

```ts
server: {
  port: 3000,
  allowedHosts: ['billing-bibit.devtun.my.id'],   // domain tunnel wajib terdaftar di sini
  proxy: { '/api': { target: 'http://localhost:7930', changeOrigin: true } },
}
```

Jadi aplikasi memakai URL relatif (`/api/...`) dan tidak butuh variabel lingkungan. Catatan:
jangan set `VITE_API_BASE_URL` ke `http://localhost:7930/api` — itu membuat path jadi `/api/api`.

Bila panel diakses lewat domain/hostname baru (tunnel), tambahkan hostname itu ke `allowedHosts`,
kalau tidak Vite menjawab `Blocked request: This host is not allowed`.

## Deploy produksi

Unit `jawara-frontend.service` menjalankan `npm run dev` (build + preview) di `:3000`.

```bash
cd frontend && npm run build
sudo systemctl restart jawara-frontend
```

Log frontend ditulis ke `frontend.log`.
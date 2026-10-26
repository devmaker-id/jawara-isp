# Rencana Implementasi Reseller & Isolasi Data — Jawara ISP

Status: **USULAN. Belum ada kode, skema, atau data produksi yang diubah.**
Tanggal: 2026-10-25. Lingkup: role `admin`, `operator`, `reseller` (login tetap email).

Bukti inspeksi (read-only): dump skema produksi `schema.sql`, `backend/migrations/` (001, 002),
`src/app/modules/{customers,services,invoices,payments,reports,admin,users,auth}/`, `frontend/src/pages/*`.

---

## A. Pilihan relasi: `customers.reseller_id` (bukan tabel penghubung)

**Keputusan: satu pelanggan dimiliki satu reseller → kolom `customers.reseller_id` (nullable).**

Alasannya berdasarkan skema dan kebutuhan nyata:

1. Semua data turunan sudah menggantung pada `customers.id`:
   `service_sessions.customer_id`, `invoices.customer_id`, dan `payments.invoice_id` → `invoices.id`.
   Menempelkan kepemilikan di `customers` membuat scoping cukup satu kondisi tambahan di setiap
   query (`JOIN customers c ON ... AND c.reseller_id = ?`), tanpa join tabel ketiga.
2. Kewajiban "seluruh data turunan miliknya" bersifat *mengikuti pelanggan*, bukan per transaksi.
   Invoice/pembayaran lama otomatis ikut berpindah bila pelanggan dioper ke reseller lain —
   perilaku yang diharapkan pada ISP (tagihan melekat pada pelanggan, bukan pada penagih).
3. Tidak ada kebutuhan riwayat penugasan yang terbukti di kode saat ini: tidak ada modul komisi,
   target, atau laporan per-reseller. Menambah tabel penghubung sekarang berarti biaya join +
   kompleksitas konsistensi tanpa pemakai.
4. Jejak "siapa memindahkan pelanggan, kapan" tetap dibutuhkan untuk audit → disimpan di
   `audit_logs` (sudah ada, `action`, `details` JSON, `user_id`, `ip_address`), **bukan** di tabel relasi.

**Kapan rencana ini harus diubah:** jika nanti muncul kebutuhan komisi/target per periode atau
satu pelanggan dapat dikelola beberapa reseller sekaligus → tambahkan
`customer_reseller_history` (aditif, tidak mengubah FK) atau tabel penghubung. Kolom
`reseller_id` tetap dipakai sebagai "pemilik aktif".

Nilai `NULL` = **tanpa pemilik** (pelanggan lama). `NULL` tidak pernah terlihat oleh reseller.

---

## B. Daftar migrasi yang diusulkan (BELUM DIJALANKAN)

Urutan wajib: 001 → 002 → 003 → (opsional 004, 005). Setiap file: precondition, validasi, rollback.

### 003_customer_reseller_ownership.sql — inti isolasi
Tujuan: menautkan pelanggan ke akun reseller, aditif & nullable agar kode lama tetap jalan.

```sql
ALTER TABLE customers
  ADD COLUMN reseller_id INT DEFAULT NULL AFTER is_active,
  ADD KEY idx_customers_reseller (reseller_id),
  ADD CONSTRAINT fk_customers_reseller FOREIGN KEY (reseller_id)
      REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;
```

- Precondition: kolom belum ada (`information_schema.COLUMNS`); 0 baris `customers` dengan
  `reseller_id` (otomatis benar); tersedia backup logis (`mysqldump --single-transaction`).
- Kompatibilitas: `INSERT`/`SELECT *` lama tetap sah; kolom baru `NULL` untuk semua pelanggan
  yang ada → **tidak ada pelanggan yang otomatis menjadi milik reseller**.
- `ON DELETE SET NULL` dipilih (bukan CASCADE): menghapus akun reseller tidak boleh menghapus
  pelanggan/tagihannya; pelanggan kembali menjadi "tanpa pemilik" dan ditangani admin.
- Indeks `idx_customers_reseller` wajib: setiap query reseller memfilter kolom ini.
- Rollback: `ALTER TABLE customers DROP FOREIGN KEY fk_customers_reseller, DROP KEY idx_customers_reseller, DROP COLUMN reseller_id;`
  (aman, tidak ada objek lain bergantung).
- Validasi sesudah: FK ada dengan `DELETE_RULE = 'SET NULL'`; `COUNT(*) WHERE reseller_id IS NULL`
  = seluruh pelanggan saat ini; `EXPLAIN` query reseller memakai `idx_customers_reseller`.

### 004_audit_logs_soft_actor.sql — sudah ada sebagai usulan (`backend/migrations/002_audit_logs_soft_actor.sql`)
Tujuan: `audit_logs.user_id` nullable + `ON DELETE SET NULL` agar jejak audit bertahan bila akun
dihapus. Statusnya sudah "USULAN, belum dijalankan". Prasyarat agar riwayat tidak hilang saat
akun dinonaktifkan/dihapus. Rollback sudah didokumentasikan (arsipkan baris `user_id IS NULL` dulu).

### 005_customer_assign_audit_index.sql — opsional, kecil
Tujuan: mempercepat penelusuran audit penugasan reseller.
```sql
ALTER TABLE audit_logs ADD KEY idx_audit_action_created (action, created_at);
```
Rollback: `DROP KEY idx_audit_action_created`. Tanpa ini, fitur tetap jalan (hanya lebih lambat).

### 006_normalize_role_enum.sql — OPSIONAL, butuh keputusan bisnis (lihat poin H)
Menormalkan nilai enum `resseler` → `reseller` dalam tiga langkah (tambah nilai, update, kunci enum)
plus kompatibilitas token lama. **Rekomendasi: jangan sekarang**; cukup dipetakan ke label UI.

### Catatan ketergantungan
- `payments` **belum ada di produksi** (migrasi `001_payments.sql` masih tertunda). Scoping
  pembayaran baru bisa diuji di produksi setelah 001 dijalankan. Sampai itu, endpoint pembayaran
  menjawab 503 dengan pesan jelas (perilaku sekarang).
- 003 tidak bergantung pada 001, jadi isolasi pelanggan/layanan/tagihan bisa lebih dulu.

---

## C. Pemetaan isolasi endpoint

Prinsip: **identitas reseller diambil dari `req.user.sub` (hasil verifikasi token + role dari DB),
bukan dari parameter/body/query.** `reseller_id` dari klien diabaikan atau ditolak 400.

Pola teknis: setiap repository menerima parameter `scope: { ownerId: number | null }`
(`null` = tanpa batasan → admin/operator). Kondisi SQL ditambahkan di klausa `WHERE`, bukan
difilter di aplikasi/frontend.

| Endpoint | Role sekarang | Aturan baru |
|---|---|---|
| `GET /customers` | admin, operator | reseller: `WHERE c.reseller_id = :self` (paginasi & hitungan `total` memakai filter yang sama) |
| `GET /customers/:id` | admin, operator | reseller: 404 bila bukan miliknya (bukan 403 — jangan bocorkan keberadaan) |
| `POST /customers` | admin, operator | reseller: `reseller_id` diisi dari token, tidak boleh diisi dari body; admin/operator wajib memilih pemilik (boleh kosong) |
| `PATCH /customers/:id`, `DELETE` | admin, operator | reseller hanya untuk pelanggannya; `DELETE` tetap admin |
| `GET /services` (`service_sessions`) | admin, operator | join `customers c` + filter pemilik |
| `GET /services/:id`, `PATCH` | admin, operator | 404 bila bukan miliknya |
| `POST /services` | admin, operator | `customer_id` wajib milik reseller tsb (cek ke DB, bukan percaya body) |
| `GET /invoices`, `GET /invoices/summary` | admin, operator | filter `i.customer_id IN (SELECT id FROM customers WHERE reseller_id = :self)`; ringkasan (`summary`) memakai filter yang sama |
| `GET /invoices/:id`, `PATCH`, `POST :id/pay` | admin, operator | 404 bila invoice bukan milik pelanggan reseller tsb |
| `GET /payments`, `/payments/summary`, `/payments/payable-invoices` | admin, operator | tambah `JOIN customers c ON c.id = i.customer_id` + filter pemilik; `total` pagination ikut terfilter |
| `GET /invoices/:id/payments`, `POST /payments`, `POST /payments/:id/void` | admin, operator (void admin) | verifikasi kepemilikan invoice **sebelum** validasi nominal; void tetap admin |
| `GET /reports` (summary/transactions/unpaid/by-method) | admin, operator | semua agregat (income, outstanding, overdue, methodTotals, rows, total) menerima `ownerId` |
| CSV | dibentuk di frontend dari baris hasil API | ikut aman **hanya jika** API sudah ter-scope; ekspor sisi server diusulkan terpisah (sekarang hanya halaman aktif) |
| `GET/POST/PATCH/DELETE /admin/users` | admin | tidak berubah (reseller 403, sudah diuji) |
| `GET/PUT /settings` | admin (+operator baca) | tidak berubah; reseller 403 |

Kebocoran yang harus ditutup bersamaan (bukan hanya daftar):
1. **Hitungan pagination** (`total`) — kalau `WHERE` hanya di baris, `total` membocorkan jumlah data reseller lain.
2. **Ringkasan/agregat** (`income`, `outstanding`, `overdue`, `by_method`) — saat ini query-nya global.
3. **Pencarian** (`search` pada nama/invoice/referensi) — pencarian lintas tenant membocorkan nama pelanggan lain.
4. **Endpoint detail & aksi** — 404 konsisten untuk ID di luar kepemilikan, termasuk `payable-invoices`.
5. **Error response** — pesan tidak boleh membedakan "tidak ada" vs "milik reseller lain".
6. **Daftar pilihan di form** — pemilih invoice/pelanggan pada form pembayaran harus memakai endpoint yang sudah ter-scope.

---

## D. Risiko dan blocker

**Blocker keputusan bisnis (perlu jawaban sebelum kode isolasi ditulis):**
1. Apakah **operator** boleh memindahkan pelanggan antar-reseller, atau hanya admin? (Rekomendasi: admin saja.)
2. Apakah **reseller** boleh membuat pelanggan baru? (Rekomendasi: ya, otomatis menjadi miliknya; jika tidak, tombol tambah disembunyikan.)
3. Apakah **reseller** boleh melihat pelanggan `reseller_id IS NULL`? (Rekomendasi: tidak, selamanya.)
4. Apakah dibutuhkan **komisi/target per reseller**? Jika ya → tambah tabel histori (mengubah rencana A).
5. Normalisasi enum `resseler` → `reseller` sekarang atau nanti (rekomendasi: nanti, label saja).

**Risiko teknis:**
- `GET /customers`, `/invoices`, `/services` **belum punya pagination/pencarian di server**; frontend
  memfilter di klien (`Customers.tsx` memakai `useMemo`). Tanpa perubahan ini, isolasi mustahil —
  data seluruh tenant tetap terkirim ke browser. Ini pekerjaan wajib, bukan opsional.
- `invoices.customer_name` adalah kolom denormalisasi; scoping harus lewat `customer_id`, jangan
  lewat nama.
- `service_sessions` FK `ON DELETE CASCADE` ke `customers`; `invoices` juga CASCADE → hapus pelanggan
  menghapus tagihan. Perilaku lama, tidak diubah di rencana ini, tetapi UI harus menonaktifkan
  pelanggan (bukan menghapus) bila sudah ada tagihan.
- `audit_logs.user_id` masih `ON DELETE CASCADE` di produksi (002 belum jalan) → **jangan** hapus akun
  berjejak; sudah ditegakkan di `admin.service.ts` (409).
- Token lama membawa role pada klaim, tetapi guard membaca role & status dari DB tiap request →
  penonaktifan akun berlaku seketika. `isTokenRevoked` tersedia untuk pencabutan eksplisit.
- Beban query: setiap query reseller menambah join; indeks `idx_customers_reseller` + indeks
  `invoices(customer_id)` (sudah ada via FK) harus dipastikan terpakai (`EXPLAIN`).

---

## E. Urutan implementasi dan tes

**Fase 0 — tanpa migrasi (bisa dikerjakan sekarang):**
1. `GET /customers` + `/invoices` + `/services`: tambah pagination/pencarian/filter server-side
   (`page`, `limit`, `search`, `status`) dengan bentuk respons yang sama seperti `payments`.
2. Endpoint admin penugasan: `PATCH /customers/:id/owner` dan `PATCH /customers/assign-owner` (bulk),
   admin-only, menulis `audit_logs` (`CUSTOMER_OWNER_ASSIGNED`), menolak target ber-role bukan reseller.
3. UI Pengguna: tampilkan kolom "Reseller" pada data pelanggan (kosong = tanpa pemilik), indikator
   jumlah pelanggan tanpa pemilik, aksi "Tetapkan reseller".
4. UI: hapus/Matikan tombol hapus pelanggan yang punya tagihan → arahkan ke nonaktifkan.
5. Test regresi: admin/operator tetap melihat semua; tidak ada perubahan perilaku.

**Fase 1 — setelah 003 disetujui & dijalankan (di luar sesi ini):**
6. `ScopeService`/helper `resolveScope(req) → { ownerId }` (reseller → `user.sub`; lainnya → `null`).
7. Terapkan scope ke repository: customers → services → invoices → payments → reports (urutan ini,
   karena tiap lapisan ikut lapisan sebelumnya).
8. Buka akses reseller di controller (`@Roles('admin','operator','resseler')`) **hanya** untuk
   endpoint yang sudah ter-scope; menu frontend menyesuaikan.
9. Frontend: halaman reseller memakai endpoint yang sama tanpa perubahan logika; sembunyikan aksi
   yang bukan haknya (backend tetap penegak utama).

**Fase 2 — pengerasan:**
10. Uji beban ringan + `EXPLAIN` untuk query ter-scope; pertimbangkan indeks komposit
    `invoices(customer_id, status, due_date)`.
11. Audit log untuk semua aksi reseller (buat pelanggan/layanan, catat pembayaran).

**Test plan (minimum yang harus lulus sebelum rilis):**

| # | Skenario | Harapan |
|---|---|---|
| 1 | admin `GET /customers` | melihat semua, termasuk tanpa pemilik |
| 2 | operator `GET /customers` | melihat semua (operasional), tanpa hak memindahkan pemilik (sesuai keputusan blocker 1) |
| 3 | reseller A `GET /customers` | hanya miliknya; `total` = jumlah miliknya; pelanggan tanpa pemilik tidak muncul |
| 4 | reseller A `GET /customers/{id milik B}` | 404 dengan pesan generik (tidak membedakan "tidak ada") |
| 5 | reseller A `GET /invoices?search=<nama pelanggan B>` | 0 hasil, bukan data B |
| 6 | reseller A `POST /payments` dengan `invoice_id` milik B | 404/403 sebelum validasi nominal; tidak ada baris `payments` baru |
| 7 | reseller A `GET /reports?type=summary` | income/outstanding/overdue hanya miliknya; tidak sama dengan nilai global |
| 8 | reseller A `GET /reports?type=unpaid` & CSV | hanya tagihan miliknya; CSV tidak memuat nama pelanggan lain |
| 9 | reseller A mengirim `reseller_id` palsu di body/query | diabaikan/ditolak 400; scope tetap dari token |
| 10 | pelanggan tanpa pemilik | tidak muncul untuk reseller mana pun; muncul di daftar admin "tanpa pemilik" |
| 11 | admin menetapkan pemilik (bulk) | `reseller_id` berubah, 1 baris `audit_logs` per pelanggan, reseller langsung melihat data |
| 12 | akun reseller dinonaktifkan | login ditolak 401; request dengan token lama 401 "Akun Anda tidak aktif"; riwayat tagihan/pembayaran tetap utuh |
| 13 | pelanggan lama (dibuat sebelum migrasi) | `reseller_id IS NULL`, tetap dapat diakses admin/operator, tidak terlihat reseller |
| 14 | hapus akun reseller berjejak | 409 "Nonaktifkan akun", bukan penghapusan |
| 15 | pagination reseller halaman 2 | `total` konsisten dengan filter, tidak berubah karena data tenant lain |

**File yang akan diubah (Fase 0–2):**
- Backend: `modules/customers/{customers.repository,customers.service,customers.controller,dto/customer.dto}.ts`,
  `modules/services/{...repository,service,controller,dto}`,
  `modules/invoices/{invoices.repository,invoices.service,invoices.controller,summary}`,
  `modules/payments/{payments.repository,payments.service,payments.controller}`,
  `modules/reports/{reports.service,reports.controller}`,
  baru: `modules/auth/scope.ts` (helper scope) + `modules/customers/customer-owner.service.ts`,
  `modules/audit/audit.service.ts` (penulis audit terpusat; sekarang audit ditulis ad-hoc di payments).
- Frontend: `pages/Customers.tsx` (kolom pemilik, filter, aksi tetapkan), `pages/Invoices.tsx`,
  `pages/Payments.tsx`, `pages/Reports.tsx` (tanpa logika scope — hanya menyesuaikan tampilan aksi),
  `config/menu.ts` (aktifkan menu untuk reseller setelah backend siap), `types/index.ts`.
- Migrasi (usulan, tidak dijalankan): `backend/migrations/003_customer_reseller_ownership.sql`,
  `005_customer_assign_audit_index.sql`, `006_normalize_role_enum.sql` (opsional).

---

## F. Perilaku akun nonaktif (sudah ada, dipertahankan)

- Login: `AuthService` menolak akun `is_active = 0` (401, pesan generik).
- Token lama: `JwtAuthGuard` membaca status dari DB setiap request → langsung 401 "Akun Anda tidak aktif";
  `isTokenRevoked` dapat dipakai untuk mencabut token secara eksplisit saat penonaktifan.
- Riwayat: tidak ada operasi yang menghapus baris `invoices`/`payments` saat akun dinonaktifkan.
- Hapus akun: ditolak 409 bila punya jejak `audit_logs`/`payments` (sudah diimplementasikan);
  alternatifnya nonaktifkan.
- `service_sessions`/`invoices` milik pelanggan reseller yang dinonaktifkan tetap ada dan menjadi
  tanggung jawab admin sampai pemiliknya dipindahkan.

---

## G. Enum `resseler`

Fakta: `users.role` = `ENUM('admin','operator','resseler')` dan `Role` di
`src/app/config/config.service.ts` bernilai `'resseler'`. Ejaan ini salah (kurang satu "s"),
tetapi konsisten di DB, kode, dan token.

Keputusan yang diusulkan: **jangan ubah enum sekarang.** Petakan ke label "Reseller" di UI
(sudah dipakai di `pages/Users.tsx` dan `menu.ts`). Alasan: rename butuh 3 langkah DDL + update data
+ transisi token lama (`resseler` dan `reseller` harus diterima guard selama masa peralihan);
risikonya tidak sepadan dengan manfaat kosmetik. Jika nanti dinormalisasi, ikuti `006` dengan
`Role` menerima kedua nilai selama satu rilis.

---

## H. Konfirmasi

Dokumen ini tidak mengubah kode, skema, konfigurasi, maupun data produksi. Tidak ada SQL yang
dijalankan, tidak ada service yang di-restart, tidak ada commit/push.
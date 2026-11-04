# OLT Syslog Client — Implementation Plan

> Rencana bertahap. **Fase 0 (discovery) mutlak diselesaikan sebelum menulis konfigurasi apa pun** — ini read-only dan tidak menyentuh produksi. Setiap fase tulis ke perangkat membutuhkan persetujuan eksplisit (sesuai aturan kerja: baca-saja dulu, konfirmasi sebelum mengubah).

## Prinsip (sesuai kebijakan proyek)

1. `radacct`/perangkat adalah sumber kebenaran; panel tidak menebak status.
2. Semua aksi tulis ke OLT memerlukan backup snapshot, audit trail, dan rollback.
3. Definisi sintaks per vendor **tidak boleh menebak** — dikunci lewat discovery read-only.
4. Tidak ada perubahan konfigurasi produksi tanpa persetujuan.

---

## Fase 0 — Discovery read-only (prasyarat, tidak ada risiko)

Sasaran: kunci sintaks `syslog`/`logging` tiap vendor/firmware.

| # | Aksi | Perangkat | Output |
|---|---|---|---|
| 0.1 | `syslog ?`, `log ?`, `logging ?` di `(config)#` | VSOL Muncang | daftar sub-perintah tulis |
| 0.2 | `show syslog`, `show logging`, `show running-config` | VSOL Muncang | status + sintaks yang terpasang |
| 0.3 | `show running-config` (cari blok syslog/log) | HiFocus Nanggela | temukan bagaimana syslog pernah di-set |
| 0.4 | `syslog ?` / `log ?` di `(config)#` | HiFocus Nanggela | sintaks tulis (bila tersedia) |
| 0.5 | `configure terminal` + `?` (tanpa `write`) | keduanya | menu mode config |

Catatan: masuk `configure terminal` lalu `exit` (tanpa `write`) **tidak mengubah** konfigurasi persisten perangkat.

**Deliverable Fase 0**: tabel `syslog.commands.ts` per vendor (analog `hisfocus.commands.ts` di proyek referensi), berisi baris perintah enable/disable/set-ip/set-port/set-severity yang **terverifikasi** beserta tanda `VERIFIED`.

## Fase 1 — Kolektor syslog internal (backend)

1. Tambah service UDP/514 di backend Jawara-ISP (acuan: `~/backend-olt/src/services/syslog/core/syslog.server.ts`).
2. IP allowlist (`SYSLOG_ALLOWED_IPS`) — hanya menerima paket dari IP OLT terdaftar.
3. Vendor resolver + parser minimum (HiFocus + VSOL) — acuan parser `backend-olt` (ONU linkup/linkdown, register/deregister, login).
4. Simpan ke tabel baru `olt_syslog_events` (migrasi `0XX_olt_syslog.sql`), jangan tumpuk ke `radacct`.
5. Hook ke notifikasi WhatsApp/Telegram (setelah monitoring ONU berjalan).

## Fase 2 — Kolom & izin

1. Migrasi `0XX_olt_syslog.sql` tambahan:
   - `olt_devices.syslog_enabled TINYINT`, `syslog_collector_ip`, `syslog_collector_port` (nilai yang *diminta* terakhir, bukan status).
   - `olt_syslog_events` + `olt_syslog_actions` (riwayat apply/rollback/read-back).
   - Izin `olt.syslog.read` (operator) dan `olt.syslog.write` (admin).
2. `read_only` tetap `1` default; mode tulis syslog digerbang oleh izin `olt.syslog.write` **dan** eksplisit flag per perangkat (jangan longgarkan kontrak read-only global secara diam-diam).

## Fase 3 — Driver tulis per vendor

Tambahkan kontrak baru yang terpisah dari `OltAdapter` (jangan mengotori kontrak baca-saja):

```ts
interface OltSyslogDriver {
  read(): Promise<SyslogClientState>;                       // show … (read-only)
  apply(next: SyslogClientTarget): Promise<SyslogClientState>; // syslog … + write
}
```

Implementasi:
- `vendors/vsol/vsol.syslog.driver.ts`
- `vendors/hisfocus/hisfocus.syslog.driver.ts`

Masing-masing memakai `PromptShell.run()` (sudah generik) + pola naik level yang sudah ada di adapter. Command diambil dari `syslog.commands.ts` hasil Fase 0.

## Fase 4 — Endpoint & service

| Endpoint | Izin | Aksi |
|---|---|---|
| `GET /api/olt/devices/:id/syslog` | `olt.syslog.read` | baca status via `show …` |
| `POST /api/olt/devices/:id/syslog` | `olt.syslog.write` | backup → apply → verify |
| `POST /api/olt/devices/:id/syslog/rollback` | `olt.syslog.write` | terapkan snapshot sebelumnya |
| `GET /api/olt/devices/:id/syslog/history` | `olt.syslog.read` | riwayat |

Setiap tulis melewati `verify()` (read-back dibandingkan dengan yang diminta) sebelum mengembalikan sukses; gagal verifikasi → status `MISMATCH` + saran rollback.

## Fase 5 — UI (lihat UI_DESIGN.md)

Modal Syslog Client di `Devices.tsx`, pakai pola `NetUI`/`RowActions` yang ada.

## Fase 6 — Pengujian

- Unit: driver menghasilkan urutan perintah yang benar per vendor (dari fixture `syslog.commands.ts`).
- Integration (staging/OLT non-produksi dulu): enable → read-back cocok → kolektor menerima UDP → disable → read-back nonaktif → rollback mengembalikan semula.
- Simulasi gagal: OLT lepas, kredensial salah, sintaks ditolak, read-back berbeda — pastikan semua jadi error human-readable + tidak ada status "sukses" palsu.

## Mekanisme rollback (wajib di setiap apply)

1. **Sebelum** apply: baca `show running-config`/`show syslog` → simpan snapshot blok syslog.
2. **Apply** nilai baru + `write`.
3. **Verifikasi** read-back.
4. Jika `MISMATCH`/gagal: apply ulang snapshot (atau `no syslog …`/`syslog disable`) + `write` + verifikasi.
5. Semua langkah tercatat di `olt_syslog_actions` + `audit_logs` (actor, timestamp, before/after).

## Urutan rilis yang disarankan

```
Fase 0 (discovery, read-only)  →  minta persetujuan hasil
Fase 1 (kolektor)              →  tanpa menyentuh OLT produksi
Fase 2 (skema+izin)
Fase 3–4 (driver+endpoint)     →  uji di OLT non-produksi
Fase 5 (UI)
Fase 6 (uji + rollback drill)  →  baru aktifkan di OLT produksi satu-per-satu
```

## Risiko utama & mitigasi

| Risiko | Mitigasi |
|---|---|
| Menebak sintaks → perangkat menolak / rusak konfig | Fase 0 discovery; command hanya dari `syslog.commands.ts` terverifikasi |
| Basi kontrak read-only global (`read_only=1`) | Syslog menulis lewat kontrak terpisah + izin `olt.syslog.write`, bukan melonggarkan adapter inventori |
| Syslog banjir / log sensitif | IP allowlist + filter event + jangan kirim `radacct` |
| Gagal verifikasi dianggap sukses | `verify()` read-back wajib; sukses hanya jika read-back cocok + (opsional) lampu UDP |

## Yang TIDAK dilakukan rencana ini

- Tidak mengubah konfigurasi NAS/FreeRADIUS/`radacct`.
- Tidak menulis syslog ke perangkat produksi sebelum Fase 0 selesai dan disetujui.
- Tidak menghapus kontrak baca-saja inventori yang sudah berjalan.
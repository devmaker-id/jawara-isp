# OLT Syslog Client — UI Design

> Rancangan antarmuka untuk mengelola Syslog Client per OLT di menu **OLT Management** panel Jawara-ISP. Konsisten dengan pola UI yang sudah ada (`frontend/src/pages/olt/Devices.tsx`, komponen `NetUI`, `RowActions`, `Card`, modal).

## 1. Letak fitur

Menu **OLT Management → Perangkat OLT** sudah menampilkan tabel perangkat. Tambahkan tindakan baru di `RowActions` setiap baris perangkat:

```
Uji koneksi · Sinkron inventori · [Syslog] · Ubah perangkat · Hapus perangkat
```

`[Syslog]` membuka **modal Syslog Client**. Hanya tampil bila `vendor` perangkat punya driver syslog (vsol / hisfocus).

## 2. Model data tampilan

```ts
interface SyslogClientState {
  enabled: boolean;          // on/off klien syslog
  collectorIp: string;       // IP kolektor internal
  collectorPort: number;     // default 514
  protocol: 'udp';           // tetap UDP (kedua vendor)
  severity: string | null;   // null = bawaan vendor; opsional bila driver dukung
  enabledEvents: string[];   // daftar event/alarm (VSOL): onu-register, onu-deregister, ...
  lastReadBack: string | null; // ringkasan show syslog / show logging terakhir
  verified: boolean;         // hasil verifikasi read-back + lampu kolektor
}
```

Status `enabled/collectorIp/…` **selalu dibaca dari perangkat lewat read-back**, bukan dari database — karena perangkat adalah sumber kebenaran (sama seperti prinsip inventori ONU). Database hanya menyimpan nilai yang *diminta* terakhir + riwayat aksi (audit), bukan klaim status.

## 3. Modal "Syslog Client"

### Bagian atas — status saat ini (read-only)

```
Syslog Client — OLT Nanggela (hisfocus · V2.2.67)

Status perangkat:
  Syslog      : aktif / nonaktif / tidak dapat dibaca
  Tujuan      : 172.10.0.2:514 / (kosong)
  Event aktif : ONU linkup, ONU linkdown, …
  [Segarkan read-back]
```

Tombol **Segarkan read-back** menjalankan `GET /api/olt/devices/:id/syslog` (read-only `show …`) dan menampilkan status asli perangkat.

### Bagian tengah — formulir

| Field | Tipe | Keterangan |
|---|---|---|
| Aktifkan Syslog | toggle | enable/disable |
| IP Kolektor | text (validasi IPv4) | IP internal Jawara-ISP |
| Port Kolektor | number | default 514 |
| Protokol | select (terkunci "UDP") | keduanya UDP |
| Event/Alarm | checkbox (VSOL) | onu-register, onu-auth-success, onu-finish, onu-deregister, onu-link-lost, onu-dying-gasp, onu-auth-failed |
| Severity | select (opsional) | hanya bila driver dukung; kosongkan = bawaan |

Catatan HiFocus: sampai sintaks SET ditemukan, field yang didukung menyesuaikan hasil discovery; UI harus menampilkan banner *"driver ini baru mendukung baca status — konfigurasi tulis menyusul"* bila belum tersedia.

### Bagian bawah — aksi & konfirmasi

```
[Verifikasi dulu]   [Terapkan Syslog]
```

Alur interaksi (aman):

1. Admin ubah nilai di formulir.
2. Klik **Terapkan** → konfirmasi modal kedua:
   *"Mengubah Syslog Client pada perangkat produksi. Konfigurasi saat ini akan dibackup, diterapkan, lalu dibaca-balik untuk verifikasi. Lanjutkan?"*
3. Panel menampilkan progress 3 langkah: *backup → terapkan → verifikasi* (status inline, bukan pesan sukses prematur).
4. Hasil rinci:
   - ✅ `terapkan OK` + `read-back cocok` + `kolektor menerima paket UDP/514` → hijau.
   - 🟡 `terapkan OK` + `read-back cocok` + `belum ada paket` → kuning, minta periksa routing/kolektor.
   - 🔴 `read-back berbeda / galat` → merah, tawarkan **[Rollback]**.

## 4. Verifikasi & rollback di UI

- **Verifikasi** = tampilkan hasil `show syslog`/`show logging`/`show running-config` (yang relevan per vendor) + status UDP/514 di kolektor, side-by-side dengan nilai yang diminta.
- **Rollback** = tombol yang mengirim konfigurasi sebelumnya (dari backup yang diambil sesaat sebelum terapkan). Jalur yang sama dengan terapkan, hanya arah nilainya dibalik.
- Setiap aksi tulis dicatat ke `audit_logs` (pola `OLT_DEVICE_UPDATED` yang sudah ada) dengan `action=OLT_SYSLOG_APPLIED/OLT_SYSLOG_ROLLBACK/OLT_SYSLOG_READBACK` + snapshot sebelum/sesudah.

## 5. Izin (RBAC)

| Role | Akses |
|---|---|
| admin | konfigurasi + rollback + read-back |
| operator | read-back saja (tidak boleh tulis) |
| reseller | tidak tampil |

Izin baru: `olt.syslog.read` dan `olt.syslog.write`, ditambah lewat migrasi SQL (pola `022_olt.sql`).

## 6. States & error yang harus ditampung (human-readable)

| Kondisi | Pesan |
|---|---|
| Perangkat offline | "OLT tidak menjawab; konfigurasi syslog tidak bisa dibaca/diubah." |
| Vendor belum didukung | "Driver syslog untuk vendor ini belum tersedia." |
| Sintaks SET belum ditemukan | "Konfigurasi tulis belum tersedia untuk firmware ini; baru baca status." |
| Read-back tidak cocok | "Perangkat melaporkan nilai berbeda dari yang diminta — rollback disarankan." |
| Kolektor belum jalan | "Kolektor syslog internal belum aktif di 0.0.0.0:514." |

## 7. Wireframe singkat

```
┌ Syslog Client — OLT Nanggela (hisfocus · V2.2.67) ─────────────┐
│ Status perangkat (read-back)                          [Segarkan]│
│   Syslog : aktif · Tujuan 172.10.0.2:514 · Event: LINKUP/LINKDOWN│
│ ─────────────────────────────────────────────────────────────── │
│ [✓] Aktifkan Syslog                                             │
│ IP Kolektor   [ 172.10.0.2            ]  Port [ 514 ]  Protokol │
│ Event/Alarm   [✓] onu-register [✓] onu-link-lost …              │
│ Severity      [ bawaan ▾ ]                                      │
│ ─────────────────────────────────────────────────────────────── │
│                        [ Batal ]  [ Verifikasi ]  [ Terapkan ]   │
│  progress: backup ✓ → terapkan ✓ → read-back ⠼ → lampu kolektor │
└──────────────────────────────────────────────────────────────────┘
```

## 8. Ketergantungan UI → backend

| UI membutuhkan | Endpoint baru |
|---|---|
| Baca status | `GET /api/olt/devices/:id/syslog` |
| Terapkan | `POST /api/olt/devices/:id/syslog` |
| Rollback | `POST /api/olt/devices/:id/syslog/rollback` |
| Riwayat aksi | `GET /api/olt/devices/:id/syslog/history` |

Semua yang bersifat konfigurasi dibungkus `@Roles` + penjaga `read_only === 0` setelah fitur "mode tulis" dihidupkan per perangkat (lihat implementation plan).
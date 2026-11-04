# OLT Syslog Client — Capability

> Investigasi READ-ONLY. Tidak ada perubahan perangkat, kode, atau database yang dilakukan.

## Jawaban langsung

**Apakah Jawara-ISP benar-benar dapat mengaktifkan Syslog Client secara otomatis dari panel, bukan hanya menerima Syslog yang sudah dikonfigurasi manual?**

Saat ini: **BELUM.**

Jawara-ISP hari ini hanya bisa **membaca** OLT (inventori ONU), dan koneksi yang sama **secara teknis mampu** mengirim perintah konfigurasi — tetapi tidak ada satu pun jalur (method, endpoint, izin, UI) yang memakainya untuk menulis. Untuk mengaktifkan syslog secara otomatis dari panel, perlu dibangun jalur tulis + kolektor + verifikasi. Rinciannya di bawah.

## 1. Metode komunikasi OLT saat ini (untuk inventori ONU)

| Aspek | Fakta (dari kode) |
|---|---|
| Driver | `backend/src/app/modules/olt/` — `driver/` → `transport/` → `vendors/{vsol,hisfocus}/` |
| Transport | SSH (via `ssh2`, shell interaktif) dan telnet. `transport/ssh.transport.ts` + `telnet.transport.ts` → sama-sama menghasilkan `PromptShell`. |
| Sesi | `transport/prompt-shell.ts` — shell interaktif berbasis prompt (bukan exec per perintah), karena OLT menyimpan status mode (`enable` → `configure` → `interface`). |
| Kontrak adapter | `driver/olt-driver.ts` — `OltAdapter` hanya punya `open()`, `readOnus()`, `readOptical?()`, `close()` dan properti `opticalInInventory`. |
| Batasan | Komentar tegas di `olt-driver.ts`: *"driver hanya membaca. Tidak ada method untuk menulis konfigurasi…"* |
| Kolom `read_only` | `olt_devices.read_only TINYINT NOT NULL DEFAULT 1` (migrasi `022_olt.sql`). `repository.createDevice` menulis `read_only` = 1 secara permanen; `updateDevice` tidak pernah menyentuhnya. |
| Izin | Hanya `olt.view/create/update/delete/sync` — tidak ada izin untuk konfigurasi perangkat. |

**Perangkat terdaftar di produksi (2):**

| id | Nama | vendor | transport | host | firmware |
|---|---|---|---|---|---|
| 1 | OLT Muncang | `vsol` (GLOBAL GPON) | ssh | `id24.tunnel.my.id:3034` | V1.1.9 (prompt `OLT-MUNCANG`) |
| 2 | OLT Nanggela | `hisfocus` (Hioso/EPON) | telnet | `192.168.77.254:23` | V2.2.67 (prompt `OLT_BIBITNET`) |

## 2. Apakah koneksi itu bisa dipakai untuk konfigurasi Syslog?

**Ya — di lapisan transport.** `PromptShell.run(command)` bersifat generik: mengirim baris apa pun lalu menunggu prompt. Adapter menyimpan `this.shell` (`PromptShell`), jadi menambah method `configureSyslog()` yang memanggil `shell.run('syslog …')` adalah perubahan kecil dan tidak butuh transport baru.

**Tapi TIDAK bisa — di lapisan kontrak & layanan saat ini, karena:**

1. `OltAdapter` tidak punya method tulis (sengaja, `read_only=1`).
2. `OltService` tidak punya route/service untuk konfigurasi; komentarnya: *"Panel ini TIDAK menulis konfigurasi OLT: tidak ada `onu add`, `no onu`, `save`, `reboot`."*
3. Tidak ada endpoint HTTP, DTO, izin (`permission`), atau UI untuk konfigurasi apa pun.

Kesimpulan: **kemampuan transport sudah ada, yang belum ada hanyalah "izin" arsitektural + command set tervalidasi per vendor.**

## 3. Kemampuan konfigurasi Syslog per metode

| Metode | VSOL / GLOBAL GPON V1.1.9 | HiFocus / Hioso EPON V2.2.67 |
|---|---|---|
| **SSH/telnet CLI** | ✅ Terbukti ada menu `syslog`, `show syslog`, `show logging` (sumber: proyek referensi + dokumen vendor). Sintaks tulis **belum terkunci**. | ✅ Terbukti **sudah pernah mengirim syslog** (raw log nyata tersimpan). Perintah *SET* syslog **belum dipetakan**. |
| **HTTP API / Web** | ✅ Ada (Web UI "System Log → Syslog Server"). Panel kita memakai CLI. | ✅ Ada web (belum dieksplorasi di panel). |
| **SNMP SET** | ⚠️ SNMP ada tapi **diblokir default** (VSOL menutup SNMP/telnet saat pabrik). Belum ada OID SET syslog yang tervalidasi. | ⚠️ Tidak ada bukti SET syslog via SNMP. |
| **Metode resmi vendor** | CLI `syslog server ip <ip> port 514` (Syrotech/VSOL) atau pola `syslog add …` + `syslog activate …`. | CLI `configure terminal` + `write` (pola yang sudah dipakai untuk rename/delete ONU). |

## 4. Command / parameter yang diperlukan (ringkas)

Lihat `OLT_SYSLOG_CONFIGURATION_METHOD.md` untuk pasangan perintah lengkap. Yang dibutuhkan panel:

1. **Enable** syslog client.
2. **Disable** syslog client.
3. **Set collector IP** (IP kolektor internal Jawara-ISP).
4. **Set collector port** (standar 514/UDP).
5. **Set protocol** (UDP — kedua vendor pakai UDP).
6. **Set severity/filter** (tingkat log; VSOL punya `zebra` vs `gpond` + event/alarm terpisah).

## 5. Bisa dibaca kembali untuk verifikasi?

**Ya.**

- VSOL/GLOBAL: `show syslog`, `show logging`, `show running-config` (enable → config).
- HiFocus/Hioso: `show running-config` / `show system` (belum ada perintah `show syslog` yang terpetakan — perlu discovery).

Verifikasi read-back ini menjadi prasyarat rollback yang aman (lihat plan).

## 6. Perbedaan konfigurasi antar model/firmware

| | VSOL / GLOBAL GPON | HiFocus / Hioso EPON |
|---|---|---|
| Arsitektur daemon | `zebra` (routing/FRR) + `gpond` (GPON) — log dipisah dua daemon | Satu daemon, gaya Cisco-like (`configure terminal` → `write`) |
| Mode konfig | `enable` → `configure terminal` | `enable` → `configure terminal` |
| Event/alarm | `event …` / `alarm …` dengan mode `print/record/trap/remote/all` | ONU linkup/linkdown sudah terkirim (format syslog sendiri) |
| Save | `write` | `write` |
| Risiko kunci | Alarm profile harus ikut mengaktifkan event, kalau tidak syslog aktif tapi kosong | Sintaks SET belum ditemukan → wajib discovery dulu |

**Konsekuensi desain:** tidak ada satu command set untuk semua. Harus ada **driver syslog per vendor** (sama seperti pola adapter sekarang).

## 7. Kolektor sudah ada?

Belum ada di Jawara-ISP. Tetapi proyek referensi `~/backend-olt` sudah membangun **Syslog Server UDP/514** lengkap dengan:
- IP allowlist (`syslogAllowedIps`),
- vendor resolver + parser untuk **HiFocus** dan **VSOL**,
- skema event (`SyslogEventType`), penyimpanan `SyslogEventLog`, notifikasi Telegram.

Format syslog nyata yang sudah terbukti:

```
<30>Jun 24 01:53:09 OLT_BIBITNET: [2026-06-24 01:53:09] ONU 0/4:26 [1C:27:04:B0:B3:AF] [pak_mamay] linkup
<30>Jun 24 01:52:01 OLT_BIBITNET: User admin login from CLI 172.10.0.247
```

Artinya: sisi **penerima** sudah pernah terbukti berfungsi; yang belum ada di Jawara-ISP adalah (a) jalur tulis di panel dan (b) kolektor itu sendiri di dalam Jawara-ISP.

## Kesimpulan kapabilitas

| Kemampuan | Status |
|---|---|
| Membaca inventori ONU | ✅ Produksi (baca-saja) |
| Mengirim perintah apa pun ke OLT | ✅ Mampu di transport (`PromptShell.run`), **tidak diekspos** |
| Mengaktifkan syslog otomatis dari panel | ❌ Belum dibangun (butuh driver tulis + endpoint + izin + UI + kolektor) |
| Menerima syslog | ✅ Sudah terbukti (di proyek referensi `backend-olt`), ❌ belum ada di Jawara-ISP |
| Sintaks tulis syslog | 🟡 VSOL: ditemukan, belum terkunci; HiFocus: belum dipetakan |

**Untuk benar-benar "aktif otomatis dari panel", prasyarat #1 adalah discovery read-only di perangkat hidup** (`syslog ?`, `show syslog`, `show logging`, `show running-config`) guna mengunci sintaks persis per vendor/firmware — sebelum menulis baris kode konfigurasi apa pun.
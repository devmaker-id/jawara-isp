# OLT Syslog Client — Configuration Method

> Perintah-perintah di bawah adalah hasil investigasi read-only (kode repo + proyek referensi `~/backend-olt` + dokumentasi vendor + riset web). **Status VERIFIKASI dibedakan tegas**: `✅ Terverifikasi` = sudah terbukti dari log/CLI nyata; `🟡 Perlu discovery` = menu ditemukan tapi sintaks persis belum dikunci di perangkat hidup; `❓ Belum diketahui` = belum pernah dipetakan. Jangan menjalankan perintah tulis sebelum discovery.

## Standar kolektor internal Jawara-ISP

```
OLT  →  UDP/514  →  Kolektor internal Jawara-ISP (bit78)
```

- Protocol: **UDP** (kedua vendor).
- Port: **514** (bisa disesuaikan).
- Collector IP: alamat yang dapat dijangkau OLT dari VLAN manajemen (ditentukan saat implementasi; contoh internal `172.10.0.x`).

---

## A. VSOL / GLOBAL GPON OLT — Platform V1.1.9

### A.1 Mode & naik level

```
login → OLT-MUNCANG>          (user mode)
  enable                       (minta password enable)
→ OLT-MUNCANG#                 (privileged)
  configure terminal
→ OLT-MUNCANG(config)#         (config mode)  ← perintah syslog di sini
```

### A.2 Baca status logging (read-only) — prasyarat verifikasi

```
show logging          # ✅ Terverifikasi jalan; menampilkan status per daemon
```

Contoh output nyata (dokumen referensi):

```
Logging configuration for zebra:
  Syslog logging: disabled
  Stdout logging: disabled
  File logging: disabled
Logging configuration for gpond:
  Syslog logging: disabled
  Stdout logging: disabled
  File logging: disabled
```

```
show syslog           # 🟡 Ditemukan sebagai menu; format output perlu discovery
syslog ?              # 🟡 Cara paling sah memetakan sintaks tulis (di config mode)
```

### A.3 Enable/Disable — kandidat sintaks (`🟡 Perlu discovery`)

Dokumen vendor & referensi menunjuk beberapa pola; urutan kemungkinan dari yang paling umum:

```
# Enable (pola Cisco/FRR-style yang diwarisi platform ini)
syslog server ip <collector-ip> port 514        # pola VSOL/Syrotech
# atau
logging <collector-ip>                          # pola "logging host" (roohweb: "logging ip address")

# Disable
no syslog server ip <collector-ip>              # hapus host tertentu
# atau
no syslog enable / syslog disable               # matikan total
```

> **Penting:** jangan menebak saat implementasi. `syslog ?` di `(config)#` mengembalikan daftar sub-perintah resmi. Itu yang harus menjadi sumber kebenaran, bukan daftar ini.

### A.4 Severity / filter — `🟡 Perlu discovery`

VSOL/GLOBAL membagi sumber ke dua daemon; event/alarm diatur terpisah (mode `print/record/trap/remote/all`):

```
event onu-register remote enable       # 🟡 pola; sintaks persis via `event ?`
alarm onu-deregister remote enable     # 🟡 pola; sintaks persis via `alarm ?`
```

Event ONU: `onu-register`, `onu-auth-success`, `onu-finish`, `onu-link-discover`.
Alarm ONU: `onu-deregister`, `onu-link-lost`, `onu-dying-gasp`, `onu-auth-failed`, `onu-illegal-register`, `onu-port-los`.

Severity level (bila platform mengikuti FRR): `alert|crit|debug|emerg|err|info|notice|warning` + target `stdout|syslog|file|monitor`.

### A.5 Simpan + read-back

```
write                  # ✅ simpan ke flash (sama seperti pola HiFocus)
show running-config    # read-back
show logging           # read-back status per daemon
```

### A.6 Catatan kunci VSOL

- Alarm profile harus turut mengaktifkan event — kalau tidak, syslog aktif tapi **tidak ada yang dikirim** (sumber: NetSense doc + dokumen referensi).
- SNMP/telnet diblokir default pabrik; SSH aktif. Panel kita sudah lewat SSH, jadi tidak terdampak.
- Default credential pabrik `admin/Xpon@Olt9417#` (jangan dipakai; kredensial produksi di safe store).

---

## B. HiFocus / Hioso EPON OLT — V2.2.67

### B.1 Mode & naik level (sudah dipakai driver yang ada)

```
login → OLT_BIBITNET>
  enable
→ OLT_BIBITNET#
  configure terminal           (pola `config terminal` juga diterima)
→ OLT_BIBITNET(config)#
```

Pola konfigurasi yang **✅ terverifikasi** di proyek referensi (`hisfocus.commands.ts`):

```
configure terminal
interface epon 0/3
onu 12 name "pak mamay"       # rename
delete onu 67                  # delete
exit
exit
write                          # simpan ke flash
```

### B.2 Status syslog — `✅ Terbukti mengirim`

Raw log nyata (format syslog HiFocus) sudah tersimpan — artinya perangkat ini **sudah pernah** dikonfigurasi kirim syslog ke kolektor:

```
<30>Jun 24 01:53:09 OLT_BIBITNET: [2026-06-24 01:53:09] ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkup
<30>Jun 24 01:53:09 OLT_BIBITNET: [2026-06-24 01:53:09] ONU 0/4:26 [ 1C:27:04:B0:B3:53 ] [pak_mamay] linkdown
```

Event yang berhasil diproses parser referensi: `ONU LINKUP`, `ONU LINKDOWN`, `ONU REGISTERED`, `ONU UNREGISTERED`.

### B.3 Perintah SET syslog — `❓ Belum dipetakan`

Perintah untuk **menetapkan** server syslog via CLI belum ditemukan di referensi mana pun yang saya miliki. Pola yang wajib diperiksa saat discovery (di `(config)#`):

```
syslog ?
log ?
logging ?
show running-config      # cari blok "syslog"/"log host" yang sudah terpasang
```

Karena raw log membuktikan perangkat ini pernah mengirim ke suatu IP, kemungkinan besar konfigurasinya sudah ada di `show running-config` dan bisa ditiru/disalin persis — ini cara paling aman untuk mengunci sintaks.

> **Hipotesis yang harus diverifikasi:** `syslogName` pada skema OLT referensi (`docs/api/olt.md`) menyimpan *hostname* yang muncul di syslog (`OLT_BIBITNET`), bukan IP tujuan. IP tujuan kemungkinan diatur lewat web UI atau `show running-config` yang belum tercatat. Jangan berasumsi.

---

## C. Verifikasi read-back (untuk konfirmasi & rollback)

| Langkah | VSOL | HiFocus |
|---|---|---|
| Status syslog aktif? | `show logging` / `show syslog` | `show running-config` (blok syslog/log) |
| Host tujuan & port | `show syslog` | `show running-config` |
| Event dikirim? | `show alarm-event information` | `show running-config` |
| Lampu nyata (sisi kolektor) | `ss -lunp \| grep 514` + `tcpdump -ni any udp port 514` | sama |

**Verifikasi dua arah** (wajib sebelum mengklaim sukses): (1) OLT melaporkan target benar lewat `show …`; (2) kolektor benar-benar menerima paket UDP/514 dari IP OLT.

---

## D. Ringkasan parameter panel → perangkat

| Parameter panel | VSOL/GLOBAL | HiFocus/Hioso |
|---|---|---|
| enabled | pola `syslog … enable` / `logging …` | ❓ (discovery) |
| collector_ip | `syslog server ip <ip> …` / `logging <ip>` | ❓ (discovery) |
| collector_port | `… port 514` | ❓ (default 514 diasumsikan) |
| protocol | UDP (tetap) | UDP (tetap) |
| severity/filter | `event …`/`alarm … remote enable` + level | ❓ (discovery) |
| save | `write` | `write` |
| read-back | `show logging`/`show syslog`/`show running-config` | `show running-config` |

**Tindakan berikutnya (read-only, sebelum kode):** jalankan `syslog ?`/`log ?`/`show running-config` pada kedua perangkat untuk mengunci sintaks D dan B.3. Ini masih read-only (masuk `configure terminal` tanpa `write` tidak mengubah apa pun), dan menjadi dasar tabel konfigurasi yang dipakai driver panel.
# Phase 0 — Device Discovery (Syslog CLI OLT)

> Investigasi READ-ONLY pada perangkat hidup. Tidak ada perubahan konfigurasi yang dipersisten (tidak ada `write`/`save` yang dikirim). Setiap perintah melewati **hard-allowlist** (menolak `write`, `delete`, `no `, `reboot`, `reload`, `copy`, `erase`, `save`, `commit`, `shutdown`, `clear`, `remove`, `reset`, `undo`). Output yang memuat kredensial di-redaksi.

## Ringkasan

| Perangkat | Vendor/Firmware | Status | Sintaks terkunci |
|---|---|---|---|
| OLT Nanggela | HiFocus/Hioso EPON **V2.2.67** | ✅ | `syslog server <ip>` |
| Jmnet Sampaleun | HiFocus/Hioso EPON **V2.2.84** | ✅ | `syslog server <ip>` |
| OLT Muncang | VSOL/GLOBAL GPON **V1.1.9** | ✅ | `syslog server ip <ip> port <port>` + `event/alarm … remote enable` |

Catatan topologi: OLT Muncang sebelumnya via tunnel publik (tak terjangkau) — kini `192.168.99.254:22` terjangkau lewat WireGuard `wg0` (`192.168.101.0/24`, peer Muncang aktif).

---

## 1. HIOSO / HISO (EPON) — TERVERIFIKASI LENGKAP

### Baca status
| Perintah | Mode | Hasil |
|---|---|---|
| `show running-config` | `#` | konfigurasi berjalan; baris `syslog server <ip>` = status. |
| `show log` | `#` | buffer log lokal (linkup/linkdown/login/system). |
| `show log ?` | `#` | filter: `epon giga-ethernet device failed linkdown linkup login loop success system`. |
| `show syslog` / `show logging` | `#` | ❌ `% Unknown command` — **bukan** perintah HiFocus. |

### Set / enable / disable
```
enable
configure terminal
syslog server <A.B.C.D>        # Satu-satunya argumen: IP (help "A.B.C.D -- Ip address")
write                            # simpan ke flash (wajib)
```

- **Tidak ada** parameter port/protocol/severity — hanya IP (fixed UDP/514, seluruh event ONU & system).
- `syslog ?` → hanya `server`. Tidak ada yang lain.
- `no ?` → tidak ada `no syslog`. **Disable = `syslog server 0.0.0.0`** (kandidat; sesi terputus saat diproses → perlu uji terkontrol: kirim, reconnect, `write`).

**Status saat ini (manual, sebelum fitur):**
```
Nanggela  → syslog server 192.168.76.254
Sampaleun → syslog server 172.10.0.247
```
Bukti sintaks `syslog server <ip>` benar bekerja & menetap.

## 2. VSOL / GLOBAL GPON — TERVERIFIKASI LENGKAP

### 2.1 Baca status
```
show logging          # "Syslog logging: disabled" per daemon (zebra + gpond)
show log-filter       # filter log saat ini (kosong bila tak ada)
show running-config   # konfigurasi berjalan (cari `remote`, `event`, `alarm`)
show startup-config   # konfigurasi tersimpan
```

### 2.2 Set remote server & enable/disable event/alarm
```
enable
configure

# (a) tentukan tujuan remote (syslog)
syslog server ip <A.B.C.D> port <PORT>     # tujuan syslog (514 = standar)

# (b) arahkan event/alarm ONU ke remote
event onu-register remote enable        # <name>/<mode>/<enable|disable>
event onu-auth-success remote enable
event onu-finish remote enable
event onu-link-discover remote enable
alarm onu-deregister remote enable
alarm onu-link-lost remote enable
alarm onu-dying-gasp remote enable
alarm onu-auth-failed remote enable
... (daftar lengkap di §2.3)

# (c) simpan
save
```

- Sintaks event/alarm **dikonfirmasi dari help perangkat**:
  - `event <name> ?` → `all | print | record | remote | trap` (mode keluaran).
  - `event <name> remote ?` → `disable | enable`.
  - `event <name> remote enable` → diterima (`<cr>`).
- **Set server**: `syslog server ip <A.B.C.D> port <PORT>` (help `syslog server ip ?` → `A.B.C.D`; lalu `?` → `port`). Terverifikasi muncul di `show running-config`.
- **Disable**: `syslog server ip 0.0.0.0 port 514` (diterima) — `port 0` dan `no syslog server …` ditolak.
- **Daemon routing (FRR/zebra)**: `log syslog <level>` (level `emergencies|alerts|critical|errors|warnings|notifications|informational|debugging`), `log facility <facility>`, `log stdout <level>`, `log file <path> <level>` — mengendalikan log daemon FRR (terpisah dari event/alarm GPON).

### 2.3 Daftar event & alarm (dari `event ?` / `alarm ?`)
**Event:** `all, config-erase, config-save, download-file-success, name, onu-auth-success, onu-deauth-success, onu-finish, onu-link-discover, onu-register, onu-upgrade-over, onu-vlan-pool, ospf-adjacency-change, ospf6-adjacency-change, pon-enable, pon-los-recovery, pon-register, reset, rip-adjacency-change, ripng-adjacency-change, time-change, upgrade-file-success, upload-file-success, user-login, user-logout`.

**Alarm:** `all, cpu-usage-high, debug, dhcp-sn-illegal-server, dhcp-sn-over-rate-limit, download-file-failed, fan, mac-flapping, mem-usage-high, name, oamlog, onu-auth-failed, onu-critical-event, onu-deregister, onu-dying-gasp, onu-event-notific, onu-illegal-register, onu-link-event, onu-link-fault, onu-link-lost, onu-loid-conflict, onu-mac-conflict, onu-number-limit, onu-offline-timeout, onu-om-lao-detect, onu-om-lol-detect, onu-pon-rxpower-high, onu-pon-rxpower-low, …`.

Event/alarm yang relevan untuk **monitoring ONU + alert**: `onu-register, onu-auth-success, onu-finish, onu-link-discover` (UP) dan `onu-deregister, onu-link-lost, onu-dying-gasp, onu-auth-failed, onu-pon-rxpower-low/-high` (DOWN/sinyal).

**Status saat ini:** `show logging` = syslog `disabled` (zebra & gpond); `show running-config` menampilkan `alarm oamlog … enable` (alarm OAM lokal sudah aktif) tetapi belum ada baris `remote`/`event … remote`.

## 3. Perbedaan antar vendor (final)

| Aspek | HiFocus/Hioso EPON | VSOL/GLOBAL GPON |
|---|---|---|
| Baca status | `show running-config` (grep `syslog server`) | `show logging` + `show running-config` |
| Set tujuan | `syslog server <ip>` | `syslog server ip <ip> port <port>` |
| Enable/disable event | n/a (semua event selalu dikirim) | `event/alarm <name> <mode> enable\|disable` |
| Port/protocol/severity | — (fixed UDP/514, semua) | port default 514; severity via `log syslog <level>`; mode `print/record/trap/remote/all` |
| Simpan | `write` | `save` |
| Tambahan | — | `log-filter` (filter log FRR) |

## 4. Temuan teknis untuk implementasi

1. **Pager HiFocus = `--Press Enter--`** (bukan `--More--`). `PromptShell.MORE_MARKER` belum menanganinya → `show running-config` (102 baris) akan menggantung bila dibaca lewat adapter yang ada. **Harus ditambahkan** sebelum read-back bekerja.
2. **VSOL `more` pager** mengirim `sh: more: not found` saat output panjang (binary `more` tak ada) → read-back VSOL juga perlu penanganan `terminal paginate`/skip pager.
3. **`show syslog`/`show logging` validitas beda antar vendor** → jangan diasumsikan sama; driver per vendor wajib.
4. **HiFocus `syslog server 0.0.0.0`** diproses lalu sesi terputus (daemon restart) → bentuk disable butuh urutan kirim→reconnect→`write`, diuji di non-produksi.
5. Kredensial & login kedua vendor sudah bekerja via transport yang ada (login/enable terkonfirmasi di discovery).

## 5. Bukti "read-only bersih" (tidak ada perubahan persisten)

- Sebelum probing, running-config Nanggela=`syslog server 192.168.76.254`, Sampaleun=`172.10.0.247`, VSOL=`syslog disabled`.
- Setelah probing (termasuk `syslog server 0.0.0.0` di HiFocus & bantuan `?` VSOL), status ketiganya **tidak berubah**.
- Tidak ada `write`/`save`/`copy` yang dikirim. Semua perintah tulis diblokir allowlist.

## 6. Artefak (tidak di-commit)
`~/.hermes/cache/scratch/phase0-*.{js,json,py}` — skrip probe read-only; kredensial dimuat dari DB/.env saat runtime, tidak di-hardcode.
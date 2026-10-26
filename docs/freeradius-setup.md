# Panduan FreeRADIUS untuk Jawara ISP (BibitNet)

Dokumen ini menjelaskan cara menyiapkan FreeRADIUS sebagai server autentikasi/akuntansi
untuk MikroTik, dan cara menghubungkannya ke panel Jawara ISP.

Status saat dokumen ditulis: **belum terpasang** di bit78.
- Paket `freeradius` belum ada (`systemctl is-active freeradius` → inactive).
- Port 1812/1813 belum listen.
- Tabel `rad*` belum ada di database `isp_billing`.

Artinya: menu **FreeRADIUS** di panel sudah ada, tetapi endpoint datanya menjawab
HTTP 503 dengan pesan jelas sampai dua hal di bawah selesai:

1. Tabel `rad*` dibuat lewat migrasi `backend/migrations/004_freeradius_schema.sql`.
2. Paket FreeRADIUS dipasang dan diarahkan ke database yang sama.

Tidak ada angka nol palsu di panel: selama belum siap, panel menyebutkan tabel yang
belum ada.

---

## 1. Urutan pekerjaan yang disarankan

1. Backup database panel.
2. Buat database khusus RADIUS (disarankan terpisah, mis. `isp_radius`) **atau** pakai
   database panel dengan tabel `rad*` di dalamnya. Panel saat ini membaca tabel `rad*`
   dari database yang sama dengan `DB_NAME`.
3. Jalankan migrasi 004 (lihat bagian 3).
4. Pasang paket FreeRADIUS + modul MySQL (bagian 4).
5. Daftarkan MikroTik sebagai NAS: dari panel (FreeRADIUS → NAS) atau SQL langsung.
6. Arahkan MikroTik ke server RADIUS (bagian 6).
7. Uji dengan satu user percobaan.

---

## 2. Prasyarat

- MariaDB/MySQL aktif di host yang sama dengan panel (default `127.0.0.1:3306`).
- Akses sudo ke bit78.
- MikroTik sudah punya IP tetap menuju server (mis. `192.168.100.253`).

---

## 3. Membuat skema tabel RADIUS

Migrasi **belum dijalankan** di produksi. Jangan jalankan tanpa persetujuan.

```bash
# 1) Backup dulu
mysqldump --single-transaction --routines --triggers --no-tablespaces \
  isp_billing > ~/backups/isp_billing/sebelum-004-$(date +%Y%m%d-%H%M%S).sql

# 2) Jalankan migrasi (sekali saja)
cd /home/devmaker/jawara-isp/backend
mariadb isp_billing < migrations/004_freeradius_schema.sql
```

Perilaku yang sudah diuji pada MariaDB 10.11:

| Skenario | Hasil |
|---|---|
| Database kosong | exit 0, 8 tabel terbentuk |
| Dijalankan ulang (semua tabel sudah ada) | ditolak: `MIG004: sebagian tabel rad* sudah ada; skema parsial ditolak` |
| Hanya sebagian tabel ada (mis. `nas` saja) | ditolak sebelum ada tabel baru dibuat |

Rollback (menghapus riwayat akuntansi RADIUS, **bukan** data panel):

```sql
DROP TABLE IF EXISTS radpostauth, radacct, radusergroup, radgroupreply,
                     radgroupcheck, radreply, radcheck, nas;
```

---

## 4. Memasang FreeRADIUS

```bash
sudo apt update
sudo apt install -y freeradius freeradius-mysql
```

Aktifkan modul SQL:

```bash
sudo ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
```

Sunting `/etc/freeradius/3.0/mods-available/sql` (bagian `sql { ... }`):

```
driver = "rlm_sql_mysql"
dialect = "mysql"

server = "127.0.0.1"
port = 3306
login = "<user-db>"
password = "<password-db>"

radius_db = "isp_billing"

read_clients = yes
client_table = "nas"
```

Pastikan file `mods-config/sql/main/mysql/queries.conf` memakai nama tabel standar
(`radcheck`, `radreply`, `radusergroup`, `radacct`, `radpostauth`) — skema migrasi 004
mengikuti nama tersebut, jadi bagian ini tidak perlu diubah.

Restart dan cek:

```bash
sudo systemctl restart freeradius
sudo systemctl status freeradius --no-pager
sudo ss -lunp | grep -E ':1812|:1813'
```

Mode debug untuk melihat proses autentikasi:

```bash
sudo freeradius -X
```

---

## 5. Mendaftarkan NAS

Dari panel: **FreeRADIUS → NAS → Tambah NAS**.

- Alamat NAS: IP sumber paket RADIUS dari MikroTik (mis. `192.168.100.254`).
- Secret: minimal 8 karakter, **harus sama** dengan yang diisi di MikroTik.
- Tipe: `mikrotik`.

Setara SQL:

```sql
INSERT INTO nas (nasname, shortname, type, ports, server, description, secret)
VALUES ('192.168.100.254', 'mikrotik-core', 'mikrotik', 1812, '', 'MikroTik core', '<secret>');
```

Secret tidak pernah dikirim balik oleh API panel.

---

## 6. Mengarahkan MikroTik

Di MikroTik (menu `/radius`):

```
/radius add service=hotspot,ppp address=192.168.100.253 secret=<secret-yang-sama> timeout=3s
/radius print
```

Agar akuntansi sesi masuk ke `radacct`:

```
/radius
set 0 accounting-backup=no
```

Untuk hotspot yang memakai RADIUS, aktifkan di profil hotspot:

```
/ip hotspot profile set [find name=default] use-radius=yes radius-accounting=yes
```

Untuk PPP (PPPoE), aktifkan di profil PPP:

```
/ppp aaa set use-radius=yes accounting=yes interim-update=5m
```

---

## 7. Uji cepat

1. Buat user percobaan: panel **FreeRADIUS → User RADIUS → Tambah user**
   (username `uji.radius`, password bebas, grup opsional).
2. Login PPPoE/hotspot memakai kredensial itu.
3. Panel **FreeRADIUS → Sesi & Akuntansi** harus menampilkan sesi berjalan
   (`acctstoptime` NULL) dan riwayat setelah user logout.

Uji langsung tanpa MikroTik:

```bash
radtest uji.radius <password> 127.0.0.1 0 <secret-nas>
```

---

## 8. Catatan keamanan

- Tabel `radcheck` menyimpan password dalam bentuk `Cleartext-Password` bila dipakai untuk
  PPPoE/hotspot PAP. Batasi akses ke database dan jangan membuka dump SQL ke publik.
- Halaman FreeRADIUS hanya untuk `admin`/`operator`; mutasi (NAS/user) hanya `admin`.
- Jangan memakai secret NAS yang sama dengan password admin MikroTik.
- Audit log panel mencatat `RADIUS_USER_CREATED`, `RADIUS_USER_UPDATED`, `RADIUS_USER_DELETED`.
#!/usr/bin/env bash
# Backup harian database billing (Jawara-ISP).
#
# Kenapa ada: sebelum ini tidak ada backup terjadwal sama sekali — satu-satunya
# salinan dibuat manual. Script ini dipanggil cron harian, menyimpan dump
# terkompresi, memeriksa hasilnya bisa dibaca, lalu menghapus salinan lama.
#
# Kredensial TIDAK disimpan di sini: dibaca dari backend/.env (mode 0600) yang
# juga dipakai aplikasi. Tidak ada nilai rahasia yang dicetak ke log.
set -euo pipefail

ENV_FILE="${JAWARA_ENV:-/home/devmaker/jawara-isp/backend/.env}"
OUT_DIR="${JAWARA_BACKUP_DIR:-/home/devmaker/backups}"
KEEP_DAYS="${JAWARA_BACKUP_KEEP_DAYS:-14}"

[ -r "$ENV_FILE" ] || { echo "GAGAL: $ENV_FILE tidak terbaca" >&2; exit 1; }
mkdir -p "$OUT_DIR"

# Ambil hanya kunci yang dibutuhkan; jangan `source` seluruh .env agar tidak
# menjalankan apa pun yang kebetulan ada di file itu.
key() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' ; }
DB_HOST=$(key DB_HOST); DB_PORT=$(key DB_PORT); DB_USER=$(key DB_USER)
DB_PASSWORD=$(key DB_PASSWORD); DB_NAME=$(key DB_NAME)
DB_PORT="${DB_PORT:-3306}"
[ -n "$DB_NAME" ] || { echo "GAGAL: DB_NAME kosong di $ENV_FILE" >&2; exit 1; }

STAMP=$(date +%Y%m%d-%H%M)
OUT="$OUT_DIR/${DB_NAME}-${STAMP}.sql.gz"
LOCK="${OUT_DIR}/.backup.lock"

# Dua backup bersamaan bisa menggandakan beban; kunci ini membuat yang kedua
# menunggu, bukan menumpuk.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "Backup lain sedang berjalan; dilewati $(date '+%F %T')"
  exit 0
fi

echo "Mulai $(date '+%F %T') -> $OUT"
if ! MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" 2>"${OUT}.err" | gzip > "$OUT"; then
  echo "GAGAL mysqldump:" >&2
  sed 's/password[^ ]*/password***/I' "${OUT}.err" >&2 || true
  rm -f "$OUT" "${OUT}.err"
  exit 1
fi
rm -f "${OUT}.err"

# Dump yang tidak bisa dibaca sama saja tidak ada — periksa sekarang.
if ! gzip -t "$OUT"; then
  echo "GAGAL: hasil gzip rusak, file dihapus" >&2
  rm -f "$OUT"
  exit 1
fi
TABLES=$(zcat "$OUT" | grep -c '^CREATE TABLE' || true)
SIZE=$(du -h "$OUT" | cut -f1)
echo "Selesai: $OUT ($SIZE, $TABLES tabel)"

# Retensi: simpan N hari terakhir.
DELETED=$(find "$OUT_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
echo "Dihapus karena lebih dari ${KEEP_DAYS} hari: ${DELETED}"

#!/usr/bin/env bash
# Pemeriksaan kesehatan Jawara-ISP untuk cron.
#
# Keluaran hanya saat ADA MASALAH atau saat layanan pulih — bila semuanya sehat
# skrip ini diam, jadi tidak mengirim notifikasi tiap 5 menit.
#
# Dipakai oleh cron Hermes dengan no_agent=true: stdout dikirim apa adanya ke
# Telegram. Jangan mencetak apa pun yang bukan pesan untuk manusia.
set -uo pipefail

STATE_FILE="${HC_STATE_FILE:-/home/devmaker/.hermes/cache/health-jawara.state}"
BACKEND_URL="${HC_BACKEND_URL:-http://127.0.0.1:7930/api/invoices}"   # 401 = hidup
FRONTEND_URL="${HC_FRONTEND_URL:-http://127.0.0.1:3000/}"             # 200 = hidup
TUNNEL_URL="${HC_TUNNEL_URL:-https://billing-bibit.devtun.my.id/}"    # 200 = tunnel jalan
ENV_FILE="${JAWARA_ENV:-/home/devmaker/jawara-isp/backend/.env}"

problems=()

# Kode HTTP yang diharapkan: backend menolak tanpa token (401), halaman & tunnel 200.
check_http() {
  local name="$1" url="$2" want="$3"
  local code
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$url" 2>/dev/null || true)
  code="${code:-000}"
  case ",$want," in
    *",$code,"*) : ;;
    *) problems+=("$name (HTTP $code, harusnya $want)") ;;
  esac
}

check_http "backend" "$BACKEND_URL" "401"
check_http "frontend" "$FRONTEND_URL" "200"
check_http "tunnel" "$TUNNEL_URL" "200"

# Database: koneksi nyata, bukan cek port.
key() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' ; }
if [ -r "$ENV_FILE" ]; then
  DB_HOST=$(key DB_HOST); DB_PORT=$(key DB_PORT); DB_USER=$(key DB_USER)
  DB_PASSWORD=$(key DB_PASSWORD); DB_NAME=$(key DB_NAME)
  if ! MYSQL_PWD="$DB_PASSWORD" mariadb -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" \
       -u"$DB_USER" -N -e "SELECT 1" "${DB_NAME:-isp_billing}" >/dev/null 2>&1; then
    problems+=("database tidak bisa diakses")
  fi
else
  problems+=("file .env backend tidak terbaca")
fi

prev="ok"
[ -r "$STATE_FILE" ] && prev=$(cat "$STATE_FILE" 2>/dev/null || echo ok)
now="ok"; [ ${#problems[@]} -gt 0 ] && now="down"

mkdir -p "$(dirname "$STATE_FILE")"
printf '%s' "$now" > "$STATE_FILE"

if [ "$now" = "down" ]; then
  # Hanya kabari saat status berubah, supaya tidak spam tiap 5 menit.
  if [ "$prev" != "down" ]; then
    printf '🔴 Jawara-ISP: masalah terdeteksi (%s)\n' "$(date '+%d/%m %H:%M')"
    for p in "${problems[@]}"; do printf '• %s\n' "$p"; done
  fi
elif [ "$prev" = "down" ]; then
  printf '✅ Jawara-ISP pulih (%s): backend, frontend, tunnel, dan database normal.\n' "$(date '+%d/%m %H:%M')"
fi

exit 0

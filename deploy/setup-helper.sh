#!/usr/bin/env bash
# ============================================================================
# setup-helper.sh — dipasang SEKALI oleh administrator, bukan oleh panel.
#
# Tujuan: memasang skrip pemasang FreeRADIUS + aturan sudo sempit, sehingga
# tombol "Pasang" di web UI bisa bekerja tanpa memberi backend akses root
# secara umum.
#
# Jalankan:  sudo bash deploy/setup-helper.sh
# Hapus:     sudo bash deploy/setup-helper.sh --remove
# ============================================================================
set -euo pipefail

TARGET=/usr/local/sbin/jawara-radius-install
CONFIG_HELPER=/usr/local/sbin/jawara-radius-config
SUDOERS=/etc/sudoers.d/jawara-radius
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan sebagai root: sudo bash $0" >&2; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  rm -f "$SUDOERS" "$TARGET" "$CONFIG_HELPER"
  echo "Dihapus: $SUDOERS"
  echo "Dihapus: $TARGET"
  echo "Dihapus: $CONFIG_HELPER"
  echo "Tombol Pasang di panel tidak akan berfungsi lagi."
  exit 0
fi

echo "== 1/4 salin skrip helper =="
install -o root -g root -m 0755 "$SRC/jawara-radius-install" "$TARGET"
echo "   $TARGET (root:root 0755)"
install -o root -g root -m 0755 "$SRC/jawara-radius-config" "$CONFIG_HELPER"
echo "   $CONFIG_HELPER (root:root 0755)"

echo "== 2/4 pastikan hanya root yang bisa mengubahnya =="
# Semua direktori induk harus milik root dan tidak writable oleh user lain.
for dir in /usr/local/sbin /usr/local /usr /usr/sbin; do
  owner="$(stat -c '%U' "$dir")"
  perm="$(stat -c '%a' "$dir")"
  [ "$owner" = "root" ] || { echo "   PERINGATAN: $dir milik $owner, bukan root" >&2; }
  case "$perm" in
    *[2367]|*[2367]?) echo "   PERINGATAN: $dir writable oleh non-root (mode $perm)" >&2 ;;
  esac
done
for file in "$TARGET" "$CONFIG_HELPER"; do
  if [ -n "$(find "$file" -perm /022 -print -quit)" ]; then
    echo "   PERINGATAN: $file writable oleh group/other" >&2
  fi
done
echo "   ok"

echo "== 3/4 pasang aturan sudo =="
install -o root -g root -m 0440 "$SRC/sudoers-jawara-radius" "$SUDOERS"
if ! visudo -c -q -f "$SUDOERS"; then
  rm -f "$SUDOERS"
  echo "   Sintaks sudoers tidak valid; aturan dibatalkan." >&2
  exit 1
fi
echo "   $SUDOERS (root:root 0440, sintaks valid)"

echo "== 4/4 uji izin tanpa menjalankan pemasangan =="
# 'sudo -n -l' hanya membaca daftar izin; tidak mengeksekusi apa pun.
for file in "$TARGET" "$CONFIG_HELPER"; do
  if sudo -u devmaker sudo -n -l "$file" >/dev/null 2>&1; then
    echo "   devmaker BOLEH menjalankan $file"
  else
    echo "   devmaker BELUM boleh menjalankan $file" >&2
    echo "   Periksa apakah user panel benar-benar 'devmaker'." >&2
  fi
done

echo
echo "Selesai. Tombol 'Pasang FreeRADIUS' di menu FreeRADIUS sekarang bisa dipakai."
echo "Untuk membatalkan: sudo bash $0 --remove"

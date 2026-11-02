"""Perintah /inet — dijawab di jalur inbound gateway, SEBELUM agen dijalankan.

Kenapa plugin, bukan skill: ``ctx.register_command`` adalah hook native Hermes
untuk slash command. Gateway memanggilnya di ``_hm_dispatch_idle_commands`` →
``_hm_dispatch_quick_and_plugin_commands`` → ``_hm_dispatch_plugin_command``,
jauh sebelum giliran agen dibuat. Jadi /inet tidak memanggil provider/model.

Yang dijaga di sini (tanpa mengubah kebijakan WhatsApp yang sudah ada):
  * hanya DM administrator yang boleh melihat data pelanggan;
  * grup mana pun ditolak (BibitNET berisi pelanggan lain);
  * nomor tidak sah / kosong dijawab langsung, tanpa LLM;
  * skrip ``scripts/inet.mjs`` hanya membaca (GET) dan tidak pernah menulis.

Perintah ini tidak menyentuh database pelanggan, nomor Internet, maupun
konfigurasi layanan.
"""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

logger = logging.getLogger("wa-inet")

REPO = Path.home() / "jawara-isp"
SCRIPT = REPO / "scripts" / "inet.mjs"

# Administrator menurut kebijakan WhatsApp (skill whatsapp-group-policy).
DEFAULT_ADMIN_IDS = ("6287886628289",)

USAGE = "Format: /inet <nomor>\nContoh: /inet 1312016"
INVALID = 'Nomor Internet "{nomor}" tidak sah. Gunakan 4-20 digit angka, contoh: /inet 1312013'
GROUP_ONLY_DM = "Pengecekan Nomor Internet hanya bisa lewat chat pribadi administrator."
NOT_ADMIN = "Perintah /inet hanya untuk administrator."

_NUMBER = re.compile(r"^[0-9]{4,20}$")


def _identity(raw: str | None) -> str:
    """Bentuk pembanding dari JID/nomor: '6287886628289:12@s.whatsapp.net' → '6287886628289'."""
    if not raw:
        return ""
    head = str(raw).split("@")[0].split(":")[0]
    digits = "".join(ch for ch in head if ch.isdigit())
    return digits or head


def _is_dm(source) -> bool:
    return str(getattr(source, "chat_type", "") or "dm").lower() in {"dm", "direct", "private", ""}


def _platform(source) -> str:
    platform = getattr(source, "platform", None)
    return str(getattr(platform, "value", platform) or "")


def _run_script(number: str) -> str:
    """Jalankan skrip baca-saja. Keluaran skrip sudah siap dikirim apa adanya."""
    try:
        done = subprocess.run(
            ["node", str(SCRIPT), number],
            cwd=str(REPO),
            capture_output=True,
            text=True,
            timeout=25,
            check=False,
        )
    except FileNotFoundError:
        logger.error("wa-inet: node atau skrip tidak ditemukan (%s)", SCRIPT)
        return "Panel billing tidak tersedia di server. Hubungi administrator."
    except subprocess.TimeoutExpired:
        logger.error("wa-inet: skrip melewati batas waktu untuk %s", number)
        return "Panel billing tidak merespons. Coba lagi beberapa saat lagi."

    teks = (done.stdout or "").strip()
    if teks:
        return teks
    cetak = (done.stderr or "").strip().splitlines()
    logger.error("wa-inet: skrip gagal (exit %s): %s", done.returncode, " | ".join(cetak[-3:]))
    return "Panel billing sedang bermasalah. Coba lagi beberapa saat lagi."


def _make_handler(admin_ids: tuple[str, ...]):
    def handle(raw_args: str, source=None, **_: object):
        # Platform lain (Telegram, CLI) tidak diubah perilakunya: serahkan ke
        # jalur biasa. Data pelanggan hanya dibuka di WhatsApp.
        if source is not None and _platform(source) != "whatsapp":
            return None

        if source is None:
            logger.warning("wa-inet: /inet tanpa konteks sumber — ditolak")
            return GROUP_ONLY_DM

        if not _is_dm(source):
            logger.info("wa-inet: /inet dari grup %s ditolak (tanpa model)", getattr(source, "chat_id", "?"))
            return GROUP_ONLY_DM

        sender = _identity(getattr(source, "user_id", None))
        if sender not in admin_ids:
            logger.info("wa-inet: /inet dari DM non-admin %s ditolak (tanpa model)", sender or "?")
            return NOT_ADMIN

        nomor = (raw_args or "").strip().split()[0] if (raw_args or "").strip() else ""
        if not nomor:
            return USAGE
        if not _NUMBER.match(nomor):
            return INVALID.format(nomor=nomor)

        logger.info("wa-inet: /inet %s dilayani router deterministik (tanpa model)", nomor)
        return _run_script(nomor)

    return handle


def register(ctx) -> None:
    configured = ctx.get_config("admin_ids", default=list(DEFAULT_ADMIN_IDS)) or []
    if isinstance(configured, str):
        configured = [part for part in configured.split(",") if part.strip()]
    admin_ids = tuple(_identity(item) for item in configured if _identity(item)) or DEFAULT_ADMIN_IDS

    ctx.register_command(
        "inet",
        handler=_make_handler(admin_ids),
        description="Cek pelanggan lewat Nomor Internet (khusus DM administrator)",
        args_hint="<nomor>",
    )
    logger.info("wa-inet: perintah /inet terdaftar (admin: %s)", ", ".join(admin_ids))

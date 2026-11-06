"""Perintah /onu_offline — daftar ONU offline, dirutekan per grup WhatsApp.

Kenapa plugin, bukan skill: ``ctx.register_command`` adalah hook native Hermes
untuk slash command; gateway menjawabnya SEBELUM agen/model dipanggil (tanpa
panggilan provider, tanpa token LLM), sama seperti /inet.

Rute yang dijaga di sini (sesuai kebijakan whatsapp-group-policy):
  * grup yang dipetakan di GROUP_OLTS → (kelak) tampilkan offline milik OLT
    yang terkait dengan grup itu;
  * DM administrator → tampilkan offline SEMUA OLT;
  * grup lain (pelanggan/keluarga/tidak dikenal) dan DM non-admin → tolak.

Data sumber: panel jawara-isp (tabel ``olt_onus``, baca-saja lewat
``scripts/onu_offline.mjs``). Tidak pernah menulis/mengubah data perangkat.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("wa-onu-offline")

REPO = Path.home() / "jawara-isp"
SCRIPT = REPO / "scripts" / "onu_offline.mjs"

# Administrator menurut kebijakan WhatsApp (skill whatsapp-group-policy).
DEFAULT_ADMIN_IDS = ("6287886628289",)

# Pemetaan grup WhatsApp -> id OLT (olt_devices.id di panel jawara-isp):
#   1 = OLT Muncang (VSOL), 2 = OLT Nanggela (HiFocus), 3 = Jmnet Sampaleun (HiFocus).
# Hanya grup TEKNIS yang boleh melihat data ONU. Grup pelanggan (BibitNET) dan
# keluarga (Saung Mama) sengaja TIDAK dipetakan -> ditolak.
DEFAULT_GROUP_OLTS = {
    "120363433225691134@g.us": (1, 2, 3),  # Teknis Z - Exploler (technical operations)
    "120363429877029752@g.us": (3,),        # JMNET -> Sampaleun
}

GROUP_DENIED = "Perintah /onu_offline tidak tersedia di grup ini."
NOT_ADMIN = "Perintah /onu_offline hanya untuk administrator."


def _identity(raw: str | None) -> str:
    """'6287886628289:12@s.whatsapp.net' -> '6287886628289'."""
    if not raw:
        return ""
    head = str(raw).split("@")[0].split(":")[0]
    digits = "".join(ch for ch in head if ch.isdigit())
    return digits or head


def _parse_group_olts(value) -> dict[str, tuple[int, ...]]:
    """Normalisasi pemetaan grup->OLT dari config (dict) string JSON, atau default."""
    if isinstance(value, str):
        import json

        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = None
    if not isinstance(value, dict):
        return dict(DEFAULT_GROUP_OLTS)
    out: dict[str, tuple[int, ...]] = {}
    for group, ids in value.items():
        ids = list(ids) if isinstance(ids, (list, tuple)) else [ids]
        ints = [int(i) for i in ids if str(i).strip().isdigit()]
        if ints:
            out[str(group)] = tuple(ints)
    return out


def _is_dm(source) -> bool:
    return str(getattr(source, "chat_type", "") or "dm").lower() in {"dm", "direct", "private", ""}


def _platform(source) -> str:
    platform = getattr(source, "platform", None)
    return str(getattr(platform, "value", platform) or "")


def _run_script(olt_ids: tuple[int, ...] | None) -> str:
    """Jalankan skrip baca-saja. Keluaran sudah siap dikirim apa adanya."""
    cmd = ["node", str(SCRIPT)]
    if olt_ids:
        cmd.append(",".join(str(i) for i in olt_ids))
    try:
        done = subprocess.run(
            cmd, cwd=str(REPO), capture_output=True, text=True, timeout=25, check=False,
        )
    except FileNotFoundError:
        logger.error("wa-onu-offline: node/skrip tidak ditemukan (%s)", SCRIPT)
        return "Panel tidak tersedia di server. Hubungi administrator."
    except subprocess.TimeoutExpired:
        logger.error("wa-onu-offline: skrip melewati batas waktu")
        return "Panel tidak merespons. Coba lagi beberapa saat lagi."

    teks = (done.stdout or "").strip()
    if teks:
        return teks
    cetak = (done.stderr or "").strip().splitlines()
    logger.error("wa-onu-offline: skrip gagal (exit %s): %s", done.returncode, " | ".join(cetak[-3:]))
    return "Panel sedang bermasalah. Coba lagi beberapa saat lagi."


def _make_handler(admin_ids: tuple[str, ...], group_olts: dict[str, tuple[int, ...]]):
    def handle(raw_args: str, source=None, **_: object):
        # Hanya layani di WhatsApp; platform lain serahkan ke jalur biasa.
        if source is not None and _platform(source) != "whatsapp":
            return None

        if source is None:
            logger.warning("wa-onu-offline: tanpa konteks sumber — ditolak")
            return NOT_ADMIN

        # DM: hanya administrator, dan tampilkan semua OLT.
        if _is_dm(source):
            sender = _identity(getattr(source, "user_id", None))
            if sender not in admin_ids:
                logger.info("wa-onu-offline: DM non-admin %s ditolak", sender or "?")
                return NOT_ADMIN
            logger.info("wa-onu-offline: admin %s minta SEMUA OLT", sender)
            return _run_script(None)

        # Grup: hanya grup yang punya pemetaan OLT.
        chat_id = str(getattr(source, "chat_id", "") or "")
        olt_ids = group_olts.get(chat_id)
        if not olt_ids:
            logger.info("wa-onu-offline: grup %s tidak dipetakan — ditolak", chat_id or "?")
            return GROUP_DENIED
        logger.info("wa-onu-offline: grup %s -> OLT %s", chat_id, ",".join(map(str, olt_ids)))
        return _run_script(olt_ids)

    return handle


def register(ctx) -> None:
    admin_cfg = ctx.get_config("admin_ids", default=list(DEFAULT_ADMIN_IDS)) or []
    if isinstance(admin_cfg, str):
        admin_cfg = [part for part in admin_cfg.split(",") if part.strip()]
    admin_ids = tuple(_identity(item) for item in admin_cfg if _identity(item)) or DEFAULT_ADMIN_IDS

    group_olts = _parse_group_olts(ctx.get_config("group_olts", default=None))

    ctx.register_command(
        "onu_offline",
        handler=_make_handler(admin_ids, group_olts),
        description="Daftar ONU offline (di grup sesuai OLT terkait, di DM admin semua OLT)",
        args_hint="",
    )
    logger.info("wa-onu-offline: /onu_offline terdaftar (grup dipetakan: %s)", ",".join(group_olts))
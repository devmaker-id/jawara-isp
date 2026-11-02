#!/home/devmaker/.hermes/installs/a74f4c93fbebdb6b/environments/44e7717bbc2d42a6ad10bdbca800a5af/venv/bin/python
"""Bukti /inet ditangani router deterministik Hermes (bukan model).

Rantai yang dijalankan adalah kode asli:
  GatewayRunner._hm_dispatch_idle_commands
    → _hm_dispatch_quick_and_plugin_commands
      → _hm_dispatch_plugin_command   (mencari handler plugin lewat registry asli)
        → handler plugin wa-inet

Yang diganti hanya dua bagian "permukaan pesan": resolver perintah dan
pembungkus eksekusi handler (aslinya juga cuma memanggil invoke_plugin_command).
_admit_command_turn — pintu masuk giliran agen, tempat model dipanggil — dibuat
meledak, jadi kalau satu kasus saja lolos ke sana, skrip ini gagal.
"""

import asyncio
import sys
from types import SimpleNamespace

sys.path.insert(0, "/home/devmaker/.hermes/hermes-agent")
# Interpreter yang dipakai runner ini tidak selalu membawa site-packages venv
# Hermes; tambahkan supaya dependensi (ruamel.yaml dll.) terbaca.
sys.path.insert(
    0, "/home/devmaker/.hermes/installs/a74f4c93fbebdb6b/environments/44e7717bbc2d42a6ad10bdbca800a5af/venv/lib/python3.14/site-packages"
)

from gateway.config import Platform
from gateway.session import SessionSource
from hermes_cli.plugin_command_dispatch import invoke_plugin_command
from hermes_cli.plugins import discover_plugins, get_plugin_command_handler

discover_plugins(force=True)

ADMIN = SessionSource(platform=Platform.WHATSAPP, chat_id="74530684965000@lid",
                      chat_type="dm", user_id="6287886628289@s.whatsapp.net")
NON_ADMIN = SessionSource(platform=Platform.WHATSAPP, chat_id="6285880446630@s.whatsapp.net",
                          chat_type="dm", user_id="6285880446630@s.whatsapp.net")
GROUP = SessionSource(platform=Platform.WHATSAPP, chat_id="120363213206712331@g.us",
                      chat_type="group", user_id="6287886628289@s.whatsapp.net")


def guild_runner():
    from gateway.run import GatewayRunner

    r = object.__new__(GatewayRunner)
    r._draining = False
    r._hm_quick_commands = lambda: {}

    async def _resolve(event, source, qk):
        return False, None, getattr(event, "command", None), None

    async def _canonical(event, source, qk, canonical):
        return False, None

    async def _run_plugin(handler, event, source, session_entry=None, args=None):
        return invoke_plugin_command(handler, event.get_command_args(), source=source,
                                     session_id="", session_key="uji",
                                     platform=source.platform.value)

    async def _admit(event, source, qk, epoch):
        raise AssertionError("PESAN SAMPAI KE GILIRAN AGEN: model akan dipanggil")

    r._hm_resolve_command = _resolve
    r._hm_dispatch_canonical_command = _canonical
    r._hm_run_plugin_handler = _run_plugin
    r._admit_command_turn = _admit
    return r


def jalankan(text, command, args, source):
    ev = SimpleNamespace(text=text, command=command, get_command_args=lambda: args)
    return asyncio.run(guild_runner()._hm_dispatch_idle_commands(ev, source, "qk-uji"))


def main() -> int:
    gagal = 0

    def cek(nama, kondisi, info=""):
        nonlocal gagal
        if kondisi:
            print(f"  ✓ {nama}")
        else:
            gagal += 1
            print(f"  ✗ {nama} — {info}")

    cek("plugin /inet terdaftar", bool(get_plugin_command_handler("inet")))

    handled, reply = jalankan("/inet 1312016", "inet", "1312016", ADMIN)
    cek("DM admin /inet 1312016 → pelanggan", handled and "Toni Gajrug" in reply and "1312016" in reply, reply[:80])

    handled, reply = jalankan("/inet", "inet", "", ADMIN)
    cek("DM admin /inet tanpa nomor → cara pakai", handled and "Format: /inet" in reply, reply[:80])

    handled, reply = jalankan("/inet 1312016", "inet", "1312016", GROUP)
    cek("Grup /inet → ditolak, tanpa data", handled and "chat pribadi administrator" in reply and "Toni" not in reply, reply[:80])

    handled, reply = jalankan("/inet 1312016", "inet", "1312016", NON_ADMIN)
    cek("DM non-admin /inet → ditolak, tanpa data", handled and "hanya untuk administrator" in reply and "Toni" not in reply, reply[:80])

    # Pesan biasa tidak boleh ditangani router: handled=False berarti rantai
    # mengembalikan pesan ke jalur agen (tempat model dipanggil).
    handled, reply = jalankan("halo, internet mati", None, "", ADMIN)
    cek("Pesan biasa tetap masuk jalur agen", handled is False and reply is None, f"handled={handled} reply={reply}")

    print("HASIL:", "SEMUA LOLOS" if gagal == 0 else f"{gagal} GAGAL")
    return 0 if gagal == 0 else 1


sys.exit(main())

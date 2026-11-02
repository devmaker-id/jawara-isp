# /inet — router deterministik WhatsApp (Hermes plugin)

Perintah `/inet <nomor>` dijawab **sebelum** agen/model dipanggil. Tidak ada
inferensi AI, tidak ada token terpakai, latensi ±0,1 detik.

## Kenapa plugin, bukan skill

Hermes 0.22.5 punya hook native untuk slash command: `ctx.register_command()`.
Gateway memanggilnya di rantai berikut, semuanya sebelum giliran agen dibuat:

```
gateway/run_inbound.py        _hm_dispatch_idle_commands
gateway/run_inbound_hooks.py   _hm_dispatch_quick_and_plugin_commands
                               _hm_dispatch_plugin_command
                               → handler plugin (tidak menyentuh provider)
```

Perintah tak dikenal juga sudah dijawab langsung oleh
`_hm_unknown_slash_reply` ("Unknown command …") tanpa LLM, jadi tidak ada
router kedua yang perlu dibuat.

## Isi

| Berkas | Fungsi |
|---|---|
| `__init__.py` | handler `/inet`: cek admin + DM, lalu jalankan `~/jawara-isp/scripts/inet.mjs` |
| `plugin.yaml` | manifest (`provides_commands: [inet]`) |
| `test-router.py` | bukti rantai dispatch asli: 6 kasus, `_admit_command_turn` dibuat meledak |

## Pasang / aktifkan

```bash
# dir profil default
cp -r deploy/hermes/wa-inet ~/.hermes/plugins/wa-inet
hermes plugins enable wa-inet          # langsung hot-reload ke gateway berjalan

# profil grup (wa-groups) — supaya /inet di grup ditolak tanpa LLM juga
mkdir -p ~/.hermes/profiles/wa-groups/plugins
cp -r deploy/hermes/wa-inet ~/.hermes/profiles/wa-groups/plugins/wa-inet
hermes -p wa-groups plugins enable wa-inet
```

`hermes plugins enable` memanggil verb control-socket `reload-plugins`, jadi
tidak perlu restart gateway dan sesi lain tidak terputus.

## Kebijakan (tidak mengubah aturan WhatsApp yang ada)

- DM administrator (`6287886628289`, bisa ditimpa lewat
  `plugins.entries.wa-inet.settings.admin_ids`) → data pelanggan.
- Grup mana pun → ditolak: "Pengecekan Nomor Internet hanya bisa lewat chat
  pribadi administrator."
- DM non-admin → ditolak.
- `/inet` tanpa nomor → cara pakai; nomor bukan angka → pesan validasi.
- Platform selain WhatsApp → ditangani jalur biasa (tidak berubah).

## Bukti

```bash
python ~/jawara-isp/deploy/hermes/wa-inet/test-router.py   # butuh venv Hermes
```

atau langsung: `~/.hermes/cache/scratch/wa-inet-router-proof` (menjalankan
rantai dispatch asli dengan plugin aktif).

## Rollback

```bash
hermes plugins disable wa-inet
hermes -p wa-groups plugins disable wa-inet
```

Setelah disable, `/inet` kembali menjadi perintah tak dikenal dan dijawab
"Unknown command" oleh Hermes (tetap tanpa LLM).

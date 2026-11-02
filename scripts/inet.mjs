#!/usr/bin/env node
// inet.mjs — cek pelanggan berdasarkan Nomor Internet, siap dikirim ke WhatsApp.
//
// Pemakaian : node scripts/inet.mjs 1312016
// Keluaran  : blok teks siap kirim (stdout), atau pesan kesalahan yang jelas.
// Kode keluar: 0 ketemu, 1 tidak ditemukan, 2 nomor tidak sah, 3 gangguan panel.
//
// Batasan keamanan:
//   * Hanya baca (GET), tidak pernah mengubah data.
//   * Token dibuat di sini dari JWT_SECRET backend/.env, umur 5 menit,
//     dan tidak pernah dicetak.
//   * Yang ditampilkan hanya data pelanggan yang memang dibutuhkan laporan:
//     nama, nomor, jenis layanan, username, paket, status/masa aktif, ONU.
//     Tidak ada password, IP, MAC, NAS, atau detail server.

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(HERE, '../backend/.env');

// Tanda tangan HS256 memakai node:crypto — tidak perlu paket jsonwebtoken.
function signToken(payload, secret) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const head = part({ alg: 'HS256', typ: 'JWT' });
  const body = part(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function readEnv() {
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return env;
}

function fail(message, code) {
  console.log(message);
  process.exit(code);
}

const input = (process.argv[2] ?? '').trim();
if (!/^[0-9]{4,20}$/.test(input)) {
  fail(`Nomor Internet "${input}" tidak sah. Gunakan 4-20 digit angka, contoh: /inet 1312013`, 2);
}

const env = readEnv();
if (!env.JWT_SECRET) fail('Panel belum bisa dihubungi: kunci layanan tidak terbaca.', 3);

const token = signToken(
  { sub: 1, email: 'admin@jawara-billing.com', role: 'admin', exp: Math.floor(Date.now() / 1000) + 300 },
  env.JWT_SECRET,
);

const base = process.env.JAWARA_API_URL || 'http://127.0.0.1:7930/api';

let res;
try {
  res = await fetch(`${base}/customers/by-internet/${encodeURIComponent(input)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
} catch {
  fail('Panel billing tidak merespons. Coba lagi beberapa saat lagi.', 3);
}

if (res.status === 404) fail(`Nomor Internet ${input} tidak ditemukan.`, 1);
if (res.status === 401 || res.status === 403) fail('Panel menolak permintaan. Hubungi administrator.', 3);
if (!res.ok) fail(`Panel sedang bermasalah (kode ${res.status}). Coba lagi beberapa saat lagi.`, 3);

const c = await res.json();
const akun = (c.accounts ?? [])[0] ?? null;

// Status pelanggan + status akun digabung jadi satu kata yang mudah dibaca.
const STATUS = { active: 'Aktif', expired: 'Kedaluwarsa', suspend: 'Disuspend', disable: 'Nonaktif' };
const AKUN = { active: 'Aktif', 'ready-to-use': 'Aktif', expired: 'Kedaluwarsa', isolir: 'Terisolir', disable: 'Nonaktif' };
const status = `${STATUS[c.status] ?? 'Tidak diketahui'}${
  akun && AKUN[akun.status] && AKUN[akun.status] !== STATUS[c.status] ? ` (akun ${AKUN[akun.status]})` : ''
}`;

const baris = [
  ['Nama', c.name],
  ['Nomor', c.internet_no],
  ['Layanan', akun ? (akun.profile_type === 'ppp' ? 'PPPoE' : 'Hotspot') : 'Tanpa layanan aktif'],
  ['Username', akun?.username ?? '—'],
  ['Paket', akun?.profile_name ?? '—'],
  ['Status', status],
];

// ONU hanya ditampilkan bila memang ada relasinya. Saat ini belum ada, jadi
// barisnya dihilangkan — bukan dikarang.
if (c.onu?.serial_number || c.onu?.onu_name) {
  baris.push(['ONU', [c.onu.onu_name, c.onu.serial_number].filter(Boolean).join(' · ')]);
  if (c.onu.rx_power_onu != null) baris.push(['Redaman', `${c.onu.rx_power_onu} dBm`]);
}

const lebar = Math.max(...baris.map(([k]) => k.length));
const isi = baris.map(([k, v]) => `${k.padEnd(lebar)} : ${v}`).join('\n');

console.log(`*Cek Nomor Internet*\n\n\`\`\`\n${isi}\n\`\`\`\n`);
console.log(
  akun
    ? `Nomor ${c.internet_no} terdaftar atas nama ${c.name}.`
    : `Nomor ${c.internet_no} terdaftar atas nama ${c.name}, tetapi belum punya akun layanan.`,
);

#!/usr/bin/env node
// onu_offline.mjs — daftar ONU offline dari panel jawara-isp, siap kirim ke WhatsApp.
//
// Pemakaian:
//   node scripts/onu_offline.mjs            # semua OLT
//   node scripts/onu_offline.mjs 1,2,3      # hanya OLT dengan id tersebut
//
// Keluaran : blok teks siap kirim (stdout), atau pesan kesalahan yang jelas.
// Kode keluar: 0 selesai, 2 argumen tidak sah, 3 gangguan panel.
//
// Keamanan: hanya baca (GET); token HS256 dibuat dari JWT_SECRET backend/.env
// (umur 5 menit) dan tidak pernah dicetak. Data yang tampil hanya yang relevan
// untuk laporan offline (nama ONU, PON/ONU) — tanpa IP/MAC/password/detail server.

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(HERE, '../backend/.env');

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

// Argumen opsional: daftar id OLT dipisah koma. Kosong = semua OLT.
const idsArg = process.argv[2]?.trim() ?? '';
let onlyIds = null;
if (idsArg) {
  const parts = idsArg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (parts.length === 0) fail('Daftar OLT tidak sah. Contoh: 1,2,3', 2);
  onlyIds = parts;
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
  res = await fetch(`${base}/olt/onus?online=false&size=1000`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
} catch {
  fail('Panel tidak merespons. Coba lagi beberapa saat lagi.', 3);
}

if (res.status === 401 || res.status === 403) fail('Panel menolak permintaan. Hubungi administrator.', 3);
if (!res.ok) fail(`Panel sedang bermasalah (kode ${res.status}). Coba lagi beberapa saat lagi.`, 3);

const data = await res.json();
let rows = data.rows ?? [];
if (onlyIds) {
  const wanted = new Set(onlyIds);
  rows = rows.filter((r) => wanted.has(Number(r.olt_id)));
}

if (rows.length === 0) {
  console.log('*ONU Offline*\n\n✅ Semua ONU dalam keadaan online.');
  process.exit(0);
}

// Kelompokkan per OLT, urutkan per PON/ONU.
const byOlt = new Map();
for (const r of rows) {
  const key = r.olt_name || `OLT #${r.olt_id}`;
  if (!byOlt.has(key)) byOlt.set(key, []);
  byOlt.get(key).push(r);
}
for (const list of byOlt.values()) {
  list.sort((a, b) => (a.port_id + '/' + a.onu_id).localeCompare(b.port_id + '/' + b.onu_id, undefined, { numeric: true }));
}

const wib = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date());

const lines = [`*ONU Offline \u2014 ${rows.length} ONU*`, `${wib} WIB`, ''];
for (const [oltName, list] of byOlt) {
  lines.push(`*${oltName}* \u00b7 ${list.length} offline`);
  lines.push('```');
  for (const r of list) {
    const nama = r.description || r.onu_name || r.customer_name || `ONU ${r.port_id}:${r.onu_id}`;
    lines.push(`${r.port_id}/${r.onu_id}  ${nama}`);
  }
  lines.push('```');
  lines.push('');
}

console.log(lines.join('\n').trimEnd());
#!/usr/bin/env node
// Accounting Recovery — monitoring + rekonsiliasi sesi RADIUS, READ-ONLY.
//
// Membaca dua sumber lalu membandingkan:
//   1. Sesi aktif NAS (MikroTik API): /ppp/active/print + /ip/hotspot/active/print
//   2. Sesi terbuka radacct (SQL SELECT): acctstoptime IS NULL
//
// Tidak menulis apa pun: tidak ada UPDATE/DELETE ke radacct, tidak ada perintah
// tulis ke perangkat. Keluaran hanya status + kandidat penutupan (dry-run).
//
// Pakai:  node scripts/accounting-recovery.js [--json]
// Harus dijalankan setelah `cd backend && npm run build` (memakai RouterOsClient
// dan decryptSecret hasil kompilasi di dist/).
const path = require('path');
const BACKEND = process.env.JAWARA_BACKEND || path.join(__dirname, '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const mysql = require(path.join(BACKEND, 'node_modules', 'mysql2', 'promise'));
const { RouterOsClient } = require(path.join(BACKEND, 'dist', 'app', 'modules', 'mikrotik', 'routeros.client.js'));
const { decryptSecret } = require(path.join(BACKEND, 'dist', 'app', 'modules', 'mikrotik', 'crypto.js'));

const STALE_MINUTES = 10;

// RouterOS menulis session-id PPPoE dengan awalan "0x" (mis. 0x81D00018),
// sedangkan radacct menyimpannya tanpa awalan dan huruf kecil (81d00018).
const normSessionId = (value) => String(value ?? '').replace(/^0x/i, '').toLowerCase();

async function connectDb() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

/** Daftar NAS: gabungkan tabel `nas` dengan kredensial API di mikrotik_devices. */
async function listNas(db) {
  const [rows] = await db.query(`
    SELECT n.nasname, n.shortname, d.api_port, d.api_user, d.api_password
      FROM nas n
      LEFT JOIN mikrotik_devices d ON d.host = n.nasname
     ORDER BY n.nasname`);
  return rows;
}

/** Sesi aktif di satu NAS (print read-only). Gagal = NAS tidak terjangkau. */
async function nasActiveSessions(row) {
  if (!row.api_user) return { reachable: false, reason: 'tidak ada kredensial API', ppp: [], hotspot: [] };
  const client = new RouterOsClient({
    host: row.nasname,
    port: Number(row.api_port) || 8728,
    user: row.api_user,
    password: decryptSecret(row.api_password, process.env.SECRET_KEY),
    timeoutMs: 6000,
  });
  try {
    const [ppp, hotspot] = await client.executeEach([['/ppp/active/print'], ['/ip/hotspot/active/print']]);
    return { reachable: true, reason: null, ppp: ppp.records, hotspot: hotspot.records };
  } catch (error) {
    return { reachable: false, reason: error.message, ppp: [], hotspot: [] };
  }
}

async function openRadacct(db) {
  const [rows] = await db.query(`
    SELECT acctsessionid, username, nasipaddress, nasporttype, framedipaddress,
           callingstationid, acctstarttime, acctupdatetime, acctsessiontime
      FROM radacct WHERE acctstoptime IS NULL
     ORDER BY acctstarttime DESC`);
  return rows;
}

function classify(nas, session) {
  const up = session.acctupdatetime ? new Date(session.acctupdatetime) : null;
  const stale = up !== null && up.getTime() < Date.now() - STALE_MINUTES * 60_000;

  if (nas.reachable) {
    // Cocokkan lewat identitas, BUKAN hanya username. PPPoE: session-id.
    // Hotspot (tanpa session-id): MAC + IP. Tidak menebak jenis dari
    // nasporttype — nilainya tidak andal (RouterOS mengirim 'Wireless-802.11'
    // untuk hotspot).
    const presentPpp = nas.ppp.some(
      (r) => normSessionId(r['session-id']) === normSessionId(session.acctsessionid),
    );
    const presentHotspot = nas.hotspot.some(
      (r) =>
        String(r.address ?? '') === String(session.framedipaddress ?? '') &&
        String(r['mac-address'] ?? '').toLowerCase() ===
          String(session.callingstationid ?? '').toLowerCase(),
    );
    const present = presentPpp || presentHotspot;

    if (!stale && present) return 'NORMAL';
    if (stale && present) return 'STALE_NAS_ONLINE';
    if (stale && !present) return 'STOP_MISSING'; // kandidat penutupan
    if (!stale && !present) {
      // Belum basi tapi tidak ada di NAS: bisa putus tanpa Stop, atau kunci
      // identitas tidak cocok. Butuh tinjauan manusia.
      return 'REVIEW_REQUIRED';
    }
    return 'REVIEW_REQUIRED';
  }
  if (stale) return 'STALE_NAS_OFFLINE';
  return 'REVIEW_REQUIRED';
}

function main() {
  const json = process.argv.includes('--json');
  connectDb()
    .then(async (db) => {
      try {
        const [nasRows, radacct] = await Promise.all([listNas(db), openRadacct(db)]);
        const nasStates = [];
        for (const n of nasRows) {
          const active = await nasActiveSessions(n);
          nasStates.push({ nasname: n.nasname, shortname: n.shortname, active });
        }

        const report = { generated_at: new Date().toISOString(), nas: [], sessions: [], missing_accounting: [] };

        for (const ns of nasStates) {
          const nas = ns.active;
          report.nas.push({
            nasipaddress: ns.nasname,
            shortname: ns.shortname,
            reachable: nas.reachable,
            reason: nas.reason,
            ppp_active: nas.ppp.length,
            hotspot_active: nas.hotspot.length,
          });

          if (!nas.reachable) continue;

          // Kunci tarik-ulur untuk MENGGUGURKAN false-positive: radacct bisa
          // mencatat sesi PPP lewat session-id ataupun hotspot lewat MAC+IP, jadi
          // tiap baris radacct menghasilkan DUA kemungkinan kunci. Sesi aktif NAS
          // hanya dibandingkan bila radius=true — yang radius=false itu auth lokal
          // (mac-auth/statis) dan memang tidak akan pernah masuk radacct.
          const radacctKeys = new Set();
          for (const s of radacct.filter((s) => s.nasipaddress === ns.nasname)) {
            radacctKeys.add(`ppp:${normSessionId(s.acctsessionid)}`);
            radacctKeys.add(`hs:${(s.callingstationid ?? '').toLowerCase()}:${s.framedipaddress ?? ''}`);
          }
          for (const r of nas.ppp) {
            if (String(r.radius ?? '') !== 'true') continue;
            if (!radacctKeys.has(`ppp:${normSessionId(r['session-id'])}`)) {
              report.missing_accounting.push({
                nasipaddress: ns.nasname,
                kind: 'ppp',
                username: r.name,
                session_id: r['session-id'],
                address: r.address,
              });
            }
          }
          for (const r of nas.hotspot) {
            if (String(r.radius ?? '') !== 'true') continue;
            const key = `hs:${String(r['mac-address'] ?? '').toLowerCase()}:${r.address}`;
            if (!radacctKeys.has(key)) {
              report.missing_accounting.push({
                nasipaddress: ns.nasname,
                kind: 'hotspot',
                username: r.user,
                address: r.address,
                mac: r['mac-address'],
              });
            }
          }
        }

        for (const s of radacct) {
          const ns = nasStates.find((n) => n.nasname === s.nasipaddress);
          if (!ns) {
            report.sessions.push({ ...base(s), classification: 'REVIEW_REQUIRED', reason: 'NAS tidak terdaftar' });
            continue;
          }
          const classification = classify(ns.active, s);
          const rec = { ...base(s), classification };
          if (classification === 'STOP_MISSING') {
            const up = s.acctupdatetime ? new Date(s.acctupdatetime) : null;
            rec.stale_minutes = up ? Math.round((Date.now() - up.getTime()) / 60000) : null;
            rec.reason = 'Sesi tidak ada di aktif NAS dan update accounting sudah berhenti.';
            rec.confidence = 'medium';
            rec.proposed_action =
              'MANUAL, setelah persetujuan: set acctstoptime + acctterminatecause=Lost-Carrier. TIDAK dieksekusi otomatis.';
          }
          report.sessions.push(rec);
        }

        if (json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          emitHuman(report);
        }
      } finally {
        await db.end();
      }
    })
    .catch((error) => {
      console.error('ERR', error.message);
      process.exit(1);
    });
}

const base = (s) => ({
  nasipaddress: s.nasipaddress,
  acctsessionid: s.acctsessionid,
  username: s.username,
  framedipaddress: s.framedipaddress,
  callingstationid: s.callingstationid,
  acctstarttime: s.acctstarttime,
  acctupdatetime: s.acctupdatetime,
  acctsessiontime: s.acctsessiontime,
});

function emitHuman(report) {
  console.log('=== ACCOUNTING RECOVERY MONITOR (read-only, dry-run) ===');
  console.log(`waktu: ${report.generated_at}`);
  const r = report;
  for (const n of r.nas) {
    const on = n.reachable ? 'online' : `OFFLINE (${n.reason})`;
    console.log(
      `\nNAS ${n.shortname} (${n.nasipaddress}): ${on} · ppp_aktif=${n.ppp_active} hotspot_aktif=${n.hotspot_active}`,
    );
  }
  for (const s of r.sessions) {
    console.log(
      `\n${s.classification}: ${s.username} (${s.acctsessionid}) nas=${s.nasipaddress} ip=${s.framedipaddress}`,
    );
    if (s.reason) console.log(`  alasan: ${s.reason}`);
    if (s.stale_minutes != null) console.log(`  basi ${s.stale_minutes} menit · ${s.proposed_action ?? ''}`);
  }
  for (const m of r.missing_accounting) {
    console.log(`\nMISSING_ACCOUNTING: ${m.username} (${m.kind}) di NAS ${m.nasipaddress} — tidak ada baris radacct terbuka.`);
  }
  const candidates = r.sessions.filter((s) => s.classification === 'STOP_MISSING');
  const review = r.sessions.filter((s) => s.classification === 'REVIEW_REQUIRED');
  console.log(`\nringkasan: ${r.sessions.length} sesi terbuka · ${candidates.length} kandidat tutup · ${review.length} perlu tinjau · ${r.missing_accounting.length} missing-accounting`);
}

main();
/**
 * Jawara-ISP — WhatsApp gateway worker.
 *
 * Satu-satunya pemilik sesi WhatsApp. Berjalan sebagai proses sendiri
 * (systemd: jawara-wa.service) supaya restart gateway tidak menjatuhkan
 * backend billing, dan sebaliknya.
 *
 * Kontrak HTTP (loopback saja, wajib header `x-wa-token`):
 *   GET  /health           status koneksi + nomor + penghitung
 *   GET  /qr               QR pairing terakhir (string), atau null
 *   POST /connect          mulai/menyambung ulang koneksi
 *   POST /logout           logout + hapus sesi (butuh pairing ulang)
 *   POST /send             { to, text } → kirim pesan
 *   GET  /messages         ambil pesan masuk yang belum diambil (drain)
 *
 * Prinsip keamanan:
 *   * token wajib (dibandingkan constant-time), tanpa token → 401
 *   * bind 127.0.0.1 saja
 *   * log tidak pernah memuat kredensial; isi pesan dipotong
 */

import express from 'express';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';

const PORT = Number(process.env.WA_PORT || 3199);
const TOKEN = String(process.env.WA_TOKEN || '');
const SESSION_DIR = String(process.env.WA_SESSION_DIR || '/home/devmaker/jawara-isp/var/wa-session');

if (!TOKEN || TOKEN.length < 24) {
  console.error('WA_TOKEN wajib diisi (minimal 24 karakter). Worker berhenti.');
  process.exit(2);
}

mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'info' });

/** Status yang dilaporkan ke backend. */
const state = {
  status: 'disconnected', // disconnected | connecting | connected | logged_out
  qr: null,
  qr_at: null,
  number: null,
  connected_at: null,
  last_error: null,
  reconnect_count: 0,
  sent: 0,
  received: 0,
};

/** Antrean pesan masuk; backend mengambilnya lewat GET /messages. */
const inbox = [];
const MAX_INBOX = 500;

let sock = null;
let starting = false;
let stopped = false;
let restartTimer = null;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function note(text) {
  state.last_error = String(text).slice(0, 200);
  logger.warn({ err: state.last_error }, 'gateway event');
}

function jidNumber(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

async function start() {
  if (starting) return;
  starting = true;
  state.status = 'connecting';
  state.qr = null;

  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: authState,
      logger: pino({ level: 'warn' }),
      browser: Browsers.ubuntu('Jawara ISP Gateway'),
      markOnline: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        state.qr = qr;
        state.qr_at = new Date().toISOString();
        state.status = 'connecting';
        logger.info('QR pairing baru tersedia');
      }
      if (connection === 'open') {
        state.status = 'connected';
        state.qr = null;
        state.connected_at = new Date().toISOString();
        state.number = jidNumber(sock?.user?.id);
        state.last_error = null;
        logger.info({ number: state.number }, 'WhatsApp tersambung');
      }
      if (connection === 'close') {
        state.status = 'disconnected';
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          state.status = 'logged_out';
          state.number = null;
          note('Sesi dilogout dari perangkat. Pairing ulang diperlukan.');
          return;
        }
        state.reconnect_count += 1;
        const delay = Math.min(3000 * Math.min(state.reconnect_count, 10), 30000);
        note(`Koneksi terputus (${code ?? 'unknown'}), mencoba lagi dalam ${Math.round(delay / 1000)}s`);
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (!stopped) void start();
        }, delay);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const key = msg.key || {};
        if (!key.remoteJid || key.fromMe) continue;
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';
        // Mention/quote terhadap bot: dipakai kebijakan grup (wajib mention).
        const ctx = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo;
        const botId = sock?.user?.id || '';
        const mentioned = Boolean(
          ctx?.mentionedJid?.some((jid) => botId.startsWith(String(jid).split(':')[0])) ||
            (ctx?.participant && botId.startsWith(String(ctx.participant).split(':')[0])),
        );
        if (!text) continue;
        state.received += 1;
        inbox.push({
          id: String(key.id || ''),
          chat_id: String(key.remoteJid),
          chat_type: key.remoteJid.endsWith('@g.us') ? 'group' : 'dm',
          sender: key.participant ? jidNumber(key.participant) : jidNumber(key.remoteJid),
          sender_jid: key.participant || key.remoteJid,
          text: String(text).slice(0, 4000),
          mentioned,
          at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
        });
        if (inbox.length > MAX_INBOX) inbox.shift();
      }
    });
  } catch (error) {
    note(`Gagal memulai koneksi: ${error?.message ?? error}`);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!stopped) void start();
    }, 5000);
  } finally {
    starting = false;
  }
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  if (!safeEqual(req.get('x-wa-token') || '', TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: state.status,
    number: state.number,
    connected_at: state.connected_at,
    qr_available: Boolean(state.qr),
    reconnect_count: state.reconnect_count,
    sent: state.sent,
    received: state.received,
    pending: inbox.length,
    last_error: state.last_error,
  });
});

app.get('/qr', (_req, res) => {
  res.json({ qr: state.qr, at: state.qr_at });
});

app.post('/connect', async (_req, res) => {
  if (state.status === 'connected') return res.json({ ok: true, status: state.status });
  stopped = false;
  await start();
  res.json({ ok: true, status: state.status });
});

app.post('/logout', async (_req, res) => {
  try {
    stopped = true;
    await sock?.logout();
  } catch {
    // sesi memang sudah tidak berlaku
  }
  try {
    rmSync(SESSION_DIR, { recursive: true, force: true });
    mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  } catch (error) {
    note(`Gagal membersihkan sesi: ${error?.message ?? error}`);
  }
  sock = null;
  state.status = 'logged_out';
  state.number = null;
  state.qr = null;
  res.json({ ok: true });
});

app.post('/send', async (req, res) => {
  const to = String(req.body?.to || '').trim();
  const text = String(req.body?.text || '');
  if (!to || !text) return res.status(400).json({ error: 'to dan text wajib' });
  if (text.length > 4000) return res.status(400).json({ error: 'teks terlalu panjang' });
  if (state.status !== 'connected') return res.status(503).json({ error: 'WhatsApp belum tersambung' });

  const jid = to.includes('@') ? to : `${jidNumber(to)}@s.whatsapp.net`;
  try {
    await sock.sendMessage(jid, { text });
    state.sent += 1;
    res.json({ ok: true });
  } catch (error) {
    note(`Gagal mengirim: ${error?.message ?? error}`);
    res.status(502).json({ error: 'gagal mengirim pesan' });
  }
});

app.get('/messages', (_req, res) => {
  const batch = inbox.splice(0, inbox.length);
  res.json({ messages: batch });
});

app.listen(PORT, '127.0.0.1', () => {
  logger.info({ port: PORT }, 'worker WhatsApp siap');
  void start();
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopped = true;
    clearTimeout(restartTimer);
    logger.info('worker berhenti');
    process.exit(0);
  });
}

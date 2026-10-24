#!/usr/bin/env node
// Membuat satu akun admin awal di tabel `users`.
//
// Prinsip keamanan:
//   - password hanya dibaca dari TTY dengan echo dimatikan
//   - password/hash tidak pernah dicetak, ditulis ke file, atau masuk log
//   - tidak menerima password lewat argumen CLI (terlihat di `ps`) atau stdin pipe
//   - berhenti tanpa menulis apa pun bila sudah ada admin
//
// Jalankan dari folder backend/ :  node scripts/seed-admin.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import {
  assertSeedable,
  confirmPassword,
  describeDbError,
  hashPassword,
  validateEmail,
  validateName,
  validatePassword,
} from './lib/seed-admin-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function loadEnv() {
  // Minimal parser: cukup KEY=VALUE, abaikan komentar dan baris kosong.
  const env = {};
  let raw;
  try {
    raw = readFileSync(resolve(BACKEND_DIR, '.env'), 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exitCode = 1;
}

function ask(rl, question) {
  return new Promise((done) => rl.question(question, (answer) => done(answer.trim())));
}

// Membaca password tanpa menampilkannya. readline di-mute agar karakter
// tidak muncul di terminal maupun scrollback.
function askHidden(rl, question) {
  return new Promise((done) => {
    process.stdout.write(question);
    let collected = '';
    const restore = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };
    const onData = (char) => {
      const text = char.toString();
      if (text === '\n' || text === '\r' || text === '\u0004') {
        restore();
        process.stdout.write('\n');
        done(Buffer.from(collected).toString('utf8'));
        return;
      }
      if (text === '\u0003') {
        restore();
        process.stdout.write('\n');
        process.exit(130);
      }
      collected += text;
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    fail('Skrip ini harus dijalankan langsung di terminal (TTY). Password tidak boleh lewat pipe.');
    return;
  }

  const env = { ...loadEnv(), ...process.env };
  const dbConfig = {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'isp_billing',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'isp_billing',
  };

  if (!dbConfig.password) {
    fail('DB_PASSWORD belum diisi pada backend/.env.');
    return;
  }

  const mysql = require('mysql2/promise');
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
  } catch (error) {
    fail(`Tidak dapat terhubung ke database. ${describeDbError(error)}`);
    return;
  }

  try {
    const [rows] = await connection.query(
      "SELECT COUNT(*) AS total, SUM(role = 'admin') AS admins FROM users",
    );
    const counts = { total: Number(rows[0].total), admins: Number(rows[0].admins || 0) };

    const seedable = assertSeedable(counts);
    if (!seedable.ok) {
      fail(seedable.message);
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const name = await ask(rl, '  Nama admin       : ');
    const nameCheck = validateName(name);
    if (!nameCheck.ok) {
      rl.close();
      fail(nameCheck.message);
      return;
    }

    const email = await ask(rl, '  Email admin      : ');
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) {
      rl.close();
      fail(emailCheck.message);
      return;
    }

    // Cek duplikat sebelum meminta password agar tidak membuang waktu.
    const [existing] = await connection.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [
      email.trim(),
    ]);
    if (existing.length > 0) {
      rl.close();
      fail('Email sudah terdaftar. Tidak ada data yang ditulis.');
      return;
    }

    const password = await askHidden(rl, '  Password         : ');
    const passwordCheck = validatePassword(password, { email });
    if (!passwordCheck.ok) {
      rl.close();
      fail(passwordCheck.message);
      return;
    }

    const confirmation = await askHidden(rl, '  Ulangi password  : ');
    const confirmCheck = confirmPassword(password, confirmation);
    if (!confirmCheck.ok) {
      rl.close();
      fail(confirmCheck.message);
      return;
    }

    const passwordHash = await hashPassword(password);
    rl.close();

    await connection.execute(
      'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.trim(), passwordHash, 'admin', 1],
    );

    // Hanya identitas yang dicetak — tidak ada password atau hash.
    console.log('\n  Akun admin berhasil dibuat.');
    console.log(`  Email : ${email.trim()}`);
    console.log('  Role  : admin');
    console.log('  Login : gunakan password yang baru saja Anda masukkan.\n');
  } catch (error) {
    fail(describeDbError(error));
  } finally {
    if (connection) {
      await connection.end().catch(() => {});
    }
  }
}

main().catch(() => {
  // Tidak mencetak stack trace: bisa memuat potongan query atau data.
  fail('Terjadi kegagalan tak terduga. Tidak ada data yang ditulis.');
});

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { DatabaseService } from '../src/app/database/database.service.js';
import { decryptSecret, encryptSecret, isEncrypted } from '../src/app/modules/mikrotik/crypto.js';
import { MikrotikDevicesRepository } from '../src/app/modules/mikrotik/mikrotik-devices.repository.js';
import { MikrotikService } from '../src/app/modules/mikrotik/mikrotik.service.js';
import { assertSafeTestDatabase } from './helpers/test-db-guard';

// =====================================================================
// db-write-ok: isolated
// TES INTEGRASI TABEL mikrotik_devices — WAJIB DATABASE SEKALI-PAKAI
//
// Menjalankan:
//   DB_NAME=isp_devices_it DB_PORT=3399 DB_USER=root DB_PASSWORD= \
//   npx vitest run --config ./vitest.config.integration.ts
//
// Guard menolak jalan bila konfigurasi menunjuk produksi (isp_billing).
// DDL diambil langsung dari migrations/005_mikrotik_devices.sql (tanpa blok
// gate DELIMITER), sehingga tes ini ikut membuktikan file migrasi valid.
// =====================================================================
const target = assertSafeTestDatabase('write');
const here = dirname(fileURLToPath(import.meta.url));
const SECRET_KEY = 'kunci-integrasi-perangkat';

// config + audit_logs minimal: prasyarat migrasi 005 dan target audit tulis.
const prerequisiteSql = (): string[] => [
  `CREATE TABLE IF NOT EXISTS config (
     id INT NOT NULL AUTO_INCREMENT,
     config_key VARCHAR(64) NOT NULL,
     config_value TEXT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uq_config_key (config_key)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
     id INT NOT NULL AUTO_INCREMENT,
     user_id INT NOT NULL,
     action VARCHAR(64) NOT NULL,
     details TEXT NULL,
     ip_address VARCHAR(45) NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const migrationStatements = (): string[] => {
  const sql = readFileSync(resolve(here, '../migrations/005_mikrotik_devices.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS mikrotik_devices');
  const end = sql.indexOf("CALL _mig005_gate('post')");
  return sql
    .slice(start, end)
    .split(/;\s*(?:\r?\n|$)/)
    // Baris komentar dibuang per baris: statement seperti INSERT ... SELECT
    // didahului komentar penjelas dan tidak boleh ikut hilang.
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0);
};

describe('MikroTik — tabel perangkat dan CRUD (integrasi, DB sekali-pakai)', () => {
  let db: mysql.Connection;
  let repository: MikrotikDevicesRepository;
  let service: MikrotikService;
  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    db = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD ?? '',
      database: target.name,
      multipleStatements: true,
    });

    for (const statement of prerequisiteSql()) {
      await db.query(statement);
    }
    // Konfigurasi tunggal lama, sumber data seed migrasi.
    await db.query(
      `INSERT INTO config (config_key, config_value) VALUES
         ('mikrotik_host', '192.168.100.254'),
         ('mikrotik_port', '1998'),
         ('mikrotik_user', 'hermes'),
         ('mikrotik_password', 'rahasia-dari-config'),
         ('mikrotik_write_enabled', '0')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    );

    for (const statement of migrationStatements()) {
      await db.query(statement);
    }

    repository = new MikrotikDevicesRepository(new DatabaseService());
    service = new MikrotikService(
      { secretKey: SECRET_KEY } as never,
      new DatabaseService() as never,
      repository,
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it('tabel terbentuk dengan kolom kunci dan indeks unik nama', async () => {
    const [columns] = await db.query<mysql.RowDataPacket[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'mikrotik_devices'`,
    );
    const names = columns.map((row) => String(row.column_name ?? row.COLUMN_NAME));
    for (const column of ['name', 'host', 'api_port', 'api_user', 'api_password', 'write_enabled', 'is_active', 'last_message']) {
      expect(names).toContain(column);
    }

    const [indexes] = await db.query<mysql.RowDataPacket[]>(
      `SELECT index_name, non_unique FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'mikrotik_devices'`,
    );
    const unique = indexes.find((row) => String(row.index_name ?? row.INDEX_NAME) === 'uq_mikrotik_devices_name');
    expect(Number(unique?.non_unique ?? unique?.NON_UNIQUE)).toBe(0);
  });

  it('seed memindahkan konfigurasi tunggal lama menjadi satu perangkat', async () => {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      'SELECT name, host, api_port, api_user, api_password, description FROM mikrotik_devices',
    );
    expect(rows.length).toBe(1);
    const seeded = rows[0];
    expect(seeded.name).toBe('MikroTik Utama');
    expect(seeded.host).toBe('192.168.100.254');
    expect(Number(seeded.api_port)).toBe(1998);
    expect(seeded.api_user).toBe('hermes');
    // Password hasil seed masih teks biasa; panel mengenkripsinya saat disimpan ulang.
    expect(seeded.api_password).toBe('rahasia-dari-config');
    expect(isEncrypted(seeded.api_password)).toBe(false);
  });

  it('DDL idempoten dan seed tidak menggandakan perangkat', async () => {
    for (const statement of migrationStatements()) {
      await db.query(statement);
    }
    const [rows] = await db.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM mikrotik_devices');
    expect(Number(rows[0].n)).toBe(1);
  });

  it('CRUD lewat service menyimpan password terenkripsi dan tidak mengembalikannya', async () => {
    const name = `Router Uji ${suffix}`;
    const created = await service.createDevice(
      {
        name,
        host: '10.20.30.40',
        api_port: 1998,
        api_user: 'api-uji',
        api_password: 'sangat-rahasia-123',
        description: 'perangkat uji integrasi',
        write_enabled: false,
      },
      { userId: 1, ip: '127.0.0.1' },
    );

    expect(created?.name).toBe(name);
    expect(JSON.stringify(created)).not.toContain('sangat-rahasia-123');
    expect(created?.password_set).toBe(true);
    expect(created?.password_encrypted).toBe(true);

    const [stored] = await db.query<mysql.RowDataPacket[]>(
      'SELECT api_password FROM mikrotik_devices WHERE id = ?',
      [created?.id],
    );
    const raw = String(stored[0].api_password);
    expect(raw.startsWith('v1:')).toBe(true);
    expect(raw).not.toContain('sangat-rahasia-123');
    expect(decryptSecret(raw, SECRET_KEY)).toBe('sangat-rahasia-123');

    const updated = await service.updateDevice(
      created?.id as number,
      { host: '10.20.30.41', is_active: false },
      { userId: 1, ip: '127.0.0.1' },
    );
    expect(updated?.host).toBe('10.20.30.41');
    expect(updated?.is_active).toBe(false);

    const removed = await service.deleteDevice(created?.id as number, { userId: 1, ip: '127.0.0.1' });
    expect(removed.deleted).toBe(true);
    expect(await repository.find(created?.id as number)).toBeNull();
  });

  it('nama perangkat unik dan target memakai perangkat aktif pertama', async () => {
    const name = `Router Kembar ${suffix}`;
    await service.createDevice(
      { name, host: '10.1.1.1', api_user: 'admin', api_password: 'rahasia1' },
      { userId: 1, ip: '127.0.0.1' },
    );

    await expect(
      service.createDevice({ name, host: '10.1.1.2', api_user: 'admin' }, { userId: 1, ip: '127.0.0.1' }),
    ).rejects.toThrow(/sudah dipakai/);

    const target = await service.target();
    expect(target.source).toBe('device');
    expect(target.device_id).toBeGreaterThan(0);
    // Perangkat seed aktif lebih dulu, jadi dipakai sebagai default.
    expect(target.device_name).toBe('MikroTik Utama');
    expect(target.password).toBe('rahasia-dari-config');
  });

  it('status uji koneksi memperbarui kolom last_* di database', async () => {
    const seeded = await repository.firstActive();
    await repository.touchStatus(seeded?.id as number, {
      connected: false,
      message: 'Login API MikroTik ditolak',
      identity: null,
    });

    const refreshed = await repository.find(seeded?.id as number);
    expect(Number(refreshed?.last_connected)).toBe(0);
    expect(refreshed?.last_message).toBe('Login API MikroTik ditolak');
    expect(refreshed?.last_checked_at).toBeTruthy();

    const list = await service.listDevices();
    expect(list.ready).toBe(true);
    expect(list.rows[0].last_connected).toBe(false);
    expect(JSON.stringify(list)).not.toContain('rahasia-dari-config');
  });

  it('audit tulis tercatat untuk aksi perangkat', async () => {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT action FROM audit_logs WHERE action LIKE 'MIKROTIK_DEVICE_%' ORDER BY id ASC`,
    );
    const actions = rows.map((row) => String(row.action));
    expect(actions).toContain('MIKROTIK_DEVICE_CREATED');
    expect(actions).toContain('MIKROTIK_DEVICE_UPDATED');
    expect(actions).toContain('MIKROTIK_DEVICE_DELETED');
  });

  it('enkripsi stabil terhadap enkripsi ulang nilai yang sama', () => {
    const a = encryptSecret('abc', SECRET_KEY);
    const b = encryptSecret('abc', SECRET_KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, SECRET_KEY)).toBe('abc');
    expect(decryptSecret(b, SECRET_KEY)).toBe('abc');
  });
});
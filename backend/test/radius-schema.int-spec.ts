import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { DatabaseService } from '../src/app/database/database.service.js';
import { RadiusRepository, RADIUS_TABLES } from '../src/app/modules/freeradius/radius.repository.js';
import { assertSafeTestDatabase } from './helpers/test-db-guard';

// =====================================================================
// db-write-ok: isolated
// TES INTEGRASI SKEMA + REPOSITORY FREERADIUS — WAJIB DATABASE SEKALI-PAKAI
//
// Menjalankan:
//   DB_NAME=isp_radius_it DB_PORT=3399 DB_USER=root DB_PASSWORD= \
//   npx vitest run --config ./vitest.config.integration.ts
//
// Guard menolak jalan bila konfigurasi menunjuk produksi (isp_billing).
// DDL diambil dari migrations/004_freeradius_schema.sql (tanpa blok gate),
// sehingga tes ini sekaligus membuktikan file migrasi dapat dieksekusi.
// =====================================================================
const target = assertSafeTestDatabase('write');
const here = dirname(fileURLToPath(import.meta.url));

const ddlStatements = (): string[] => {
  const sql = readFileSync(resolve(here, '../migrations/004_freeradius_schema.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS nas');
  const end = sql.indexOf('CALL _mig004_gate(\'post\')');
  return sql
    .slice(start, end)
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith('--'));
};

describe('FreeRADIUS — skema dan repository (integrasi, DB sekali-pakai)', () => {
  let db: mysql.Connection;
  let repository: RadiusRepository;
  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    // user/password diambil dari env yang sama dengan DatabaseService; guard
    // hanya menjamin nama database tidak menunjuk produksi.
    db = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD ?? '',
      database: target.name,
      multipleStatements: true,
    });

    for (const statement of ddlStatements()) {
      await db.query(statement);
    }

    repository = new RadiusRepository(new DatabaseService());
  });

  afterAll(async () => {
    await db?.end();
  });

  it('semua tabel rad* terbentuk', async () => {
    const tables = await repository.existingTables();
    expect(tables.sort()).toEqual([...RADIUS_TABLES].sort());
  });

  it('DDL migrasi idempoten (CREATE TABLE IF NOT EXISTS)', async () => {
    for (const statement of ddlStatements()) {
      await db.query(statement);
    }
    expect((await repository.existingTables()).length).toBe(RADIUS_TABLES.length);
  });

  it('CRUD NAS berjalan dan secret tersimpan', async () => {
    const nasname = `203.0.113.${Number(suffix) % 250}`;
    const id = await repository.createNas({
      nasname,
      shortname: 'uji-core',
      secret: 'rahasia123',
      type: 'mikrotik',
      description: 'NAS uji',
    });

    const found = await repository.findNas(id);
    expect(found?.nasname).toBe(nasname);
    expect(found).not.toHaveProperty('secret');

    const secretRows = await db.query<mysql.RowDataPacket[]>(
      'SELECT secret FROM nas WHERE id = ?',
      [id],
    );
    expect(secretRows[0][0].secret).toBe('rahasia123');

    await repository.updateNas(id, { description: 'diubah', secret: 'rahasia456' });
    const updated = await repository.findNas(id);
    expect(updated?.description).toBe('diubah');

    const listed = await repository.listNas({ search: 'uji-core' });
    expect(listed.total).toBe(1);
    expect(listed.rows[0].id).toBe(id);

    expect(await repository.countNasUsingAddress(nasname)).toBe(1);

    expect(await repository.deleteNas(id)).toBe(1);
    expect(await repository.findNas(id)).toBeNull();
  });

  it('CRUD user radcheck + radusergroup berjalan dalam transaksi', async () => {
    const username = `uji.radius.${suffix}`;

    await repository.createUser({ username, password: 'rahasia1', group: 'grup-a' });
    const created = await repository.findUser(username);
    expect(created?.password).toBe('rahasia1');
    expect(created?.groupname).toBe('grup-a');

    await repository.updateUser(username, { password: 'rahasia2', group: 'grup-b' });
    const updated = await repository.findUser(username);
    expect(updated?.password).toBe('rahasia2');
    expect(updated?.groupname).toBe('grup-b');

    const listed = await repository.listUsers({ search: username });
    expect(listed.total).toBe(1);

    await repository.deleteUser(username);
    expect(await repository.findUser(username)).toBeNull();
    const groups = await db.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM radusergroup WHERE username = ?',
      [username],
    );
    expect(Number(groups[0][0].n)).toBe(0);
  });

  it('sessions hanya mengembalikan sesi berjalan, accounting memuat riwayat', async () => {
    const username = `uji.sesi.${suffix}`;
    await db.query(
      `INSERT INTO radacct (acctsessionid, acctuniqueid, username, nasipaddress, framedipaddress,
                            acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets)
       VALUES ('s-1', ?, ?, '192.168.100.254', '10.10.0.2', NOW() - INTERVAL 5 MINUTE, NULL, 300, 1000, 2000),
              ('s-2', ?, ?, '192.168.100.254', '10.10.0.3', NOW() - INTERVAL 2 HOUR, NOW() - INTERVAL 1 HOUR, 3600, 500, 700)`,
      [username, username, `${username}-b`, username],
    );

    const sessions = await repository.sessions(50);
    expect(sessions.some((row) => row.username === username)).toBe(true);
    expect(sessions.every((row) => row.username === username ? row.acctsessiontime === 300 : true)).toBe(true);

    const history = await repository.accounting(50);
    expect(history.filter((row) => row.username === username).length).toBe(2);

    const counts = await repository.counts();
    expect(counts.sessions).toBeGreaterThanOrEqual(1);
    expect(await repository.lastAccountingAt()).toBeTruthy();
  });
});
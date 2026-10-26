import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_PORT,
  ENCRYPTED_PREFIX,
  MIKROTIK_DEVICE_COLUMNS,
  MikrotikDeviceRow,
  toMikrotikDevice,
} from '../src/app/modules/mikrotik/models/mikrotik-device.model';
import {
  NAS_PUBLIC_COLUMNS,
  PASSWORD_ATTRIBUTES,
  RADIUS_TABLES,
  isPasswordAttribute,
  toNas,
  toPasswordRow,
  toRadiusGroup,
  totalOctets,
} from '../src/app/modules/freeradius/models/radius.model';

const MIGRATIONS = resolve(__dirname, '../migrations');

function readMigration(name: string): string {
  return readFileSync(resolve(MIGRATIONS, name), 'utf8');
}

// Kolom tabel diekstrak dari CREATE TABLE di file migrasi supaya model dan
// skema tidak bisa menyimpang tanpa ketahuan.
function columnsOf(sql: string, table: string): string[] {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start === -1) throw new Error(`tabel ${table} tidak ditemukan di migrasi`);
  const body = sql.slice(start, sql.indexOf('PRIMARY KEY', start));
  return [...body.matchAll(/^\s{2}([a-z_0-9]+)\s+(?:BIGINT|INT|VARCHAR|DATETIME|TIMESTAMP|TINYINT|CHAR|DECIMAL)/gim)].map(
    (m) => m[1],
  );
}

// Kolom yang ditambahkan lewat ALTER TABLE ... ADD COLUMN (migrasi lanjutan).
function alteredColumnsOf(sql: string, table: string): string[] {
  return [...sql.matchAll(new RegExp(`ALTER TABLE\\s+${table}\\s+ADD COLUMN\\s+([a-z_0-9]+)`, 'gi'))].map(
    (m) => m[1],
  );
}

describe('model mikrotik_devices', () => {
  const row = (overrides: Partial<MikrotikDeviceRow> = {}): MikrotikDeviceRow => ({
    id: 1,
    name: 'MikroTik Utama',
    host: '192.168.100.254',
    api_port: 1998,
    api_user: 'hermes',
    api_password: '',
    gui_url: null,
    description: null,
    write_enabled: 0,
    is_active: 1,
    last_checked_at: null,
    last_connected: null,
    last_message: null,
    last_identity: null,
    created_at: '2026-10-25 10:00:00',
    updated_at: '2026-10-25 10:00:00',
    ...overrides,
  });

  it('kolom model sama persis dengan migrasi 005', () => {
    const sql = readMigration('005_mikrotik_devices.sql');
    const fromSql = columnsOf(sql, 'mikrotik_devices');
    expect(fromSql.length).toBeGreaterThan(0);
    // Setiap kolom model harus ada di migrasi (urutan boleh sama, isi wajib sama).
    expect([...MIKROTIK_DEVICE_COLUMNS].sort()).toEqual([...fromSql].sort());
  });

  it('mengubah flag TINYINT menjadi boolean', () => {
    const device = toMikrotikDevice(row({ write_enabled: 0, is_active: 1 }));
    expect(device.write_enabled).toBe(false);
    expect(device.is_active).toBe(true);
    expect(typeof device.is_active).toBe('boolean');
  });

  it('tidak pernah menyertakan api_password pada model domain', () => {
    const device = toMikrotikDevice(row({ api_password: 'rahasia-secret' })) as unknown as Record<
      string,
      unknown
    >;
    expect(device).not.toHaveProperty('api_password');
    expect(Object.values(device)).not.toContain('rahasia-secret');
  });

  it('melaporkan status password tanpa membocorkan nilainya', () => {
    expect(toMikrotikDevice(row({ api_password: '' })).password_set).toBe(false);
    expect(toMikrotikDevice(row({ api_password: 'rahasia' })).password_set).toBe(true);
    expect(toMikrotikDevice(row({ api_password: 'rahasia' })).password_encrypted).toBe(false);
    expect(
      toMikrotikDevice(row({ api_password: `${ENCRYPTED_PREFIX}aaa:bbb:ccc` })).password_encrypted,
    ).toBe(true);
  });

  it('memetakan last_connected tiga keadaan (null / tersambung / gagal)', () => {
    expect(toMikrotikDevice(row({ last_connected: null })).last_connected).toBeNull();
    expect(toMikrotikDevice(row({ last_connected: 1 })).last_connected).toBe(true);
    expect(toMikrotikDevice(row({ last_connected: 0 })).last_connected).toBe(false);
  });

  it('menormalkan last_checked_at Date menjadi ISO string', () => {
    const date = new Date('2026-10-25T03:00:00Z');
    expect(toMikrotikDevice(row({ last_checked_at: date })).last_checked_at).toBe(
      '2026-10-25T03:00:00.000Z',
    );
    expect(toMikrotikDevice(row({ last_checked_at: '2026-10-25 03:00:00' })).last_checked_at).toBe(
      '2026-10-25 03:00:00',
    );
    expect(toMikrotikDevice(row({ last_checked_at: null })).last_checked_at).toBeNull();
  });

  it('api_port tetap number walau driver mengembalikan string', () => {
    const device = toMikrotikDevice(row({ api_port: '1998' as unknown as number }));
    expect(device.api_port).toBe(DEFAULT_API_PORT);
    expect(typeof device.api_port).toBe('number');
  });
});

describe('model FreeRADIUS', () => {
  it('delapan tabel model sama dengan migrasi 004', () => {
    const sql = readMigration('004_freeradius_schema.sql');
    for (const table of RADIUS_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
  });

  it('kolom nas publik tidak memuat secret', () => {
    // `ros_version` ditambahkan lewat ALTER TABLE di migrasi 010, sisanya dari 004.
    const fromSql = [
      ...columnsOf(readMigration('004_freeradius_schema.sql'), 'nas'),
      ...alteredColumnsOf(readMigration('010_nas_ros_version.sql'), 'nas'),
    ];
    expect(fromSql).toContain('secret');
    expect(fromSql).toContain('ros_version');
    expect(NAS_PUBLIC_COLUMNS).not.toContain('secret');
    // Setiap kolom publik harus benar-benar ada di tabel.
    for (const column of NAS_PUBLIC_COLUMNS) {
      expect(fromSql).toContain(column);
    }
  });

  it('toNas membuang secret dari baris database', () => {
    const nas = toNas({
      id: 1,
      nasname: '192.168.100.254',
      shortname: 'nanggela',
      type: 'mikrotik',
      ports: 1812,
      server: '',
      community: null,
      description: 'NAS utama',
      secret: 'rahasia-bersama',
      require_ma: 0,
    }) as unknown as Record<string, unknown>;

    expect(nas).not.toHaveProperty('secret');
    expect(Object.values(nas)).not.toContain('rahasia-bersama');
    expect(nas.shortname).toBe('nanggela');
  });

  it('kolom radcheck memakai pasangan attribute/value, bukan password', () => {
    const sql = readMigration('004_freeradius_schema.sql');
    const fromSql = columnsOf(sql, 'radcheck');
    expect(fromSql).toEqual(['id', 'username', 'attribute', 'op', 'value']);
    expect(fromSql).not.toContain('password');
  });

  it('toPasswordRow menulis Cleartext-Password dengan op :=', () => {
    const row = toPasswordRow('budi', 'rahasia');
    expect(row.attribute).toBe('Cleartext-Password');
    expect(row.op).toBe(':=');
    expect(row.value).toBe('rahasia');
    expect(row.username).toBe('budi');
  });

  it('isPasswordAttribute hanya menerima atribut kredensial', () => {
    for (const attribute of PASSWORD_ATTRIBUTES) {
      expect(isPasswordAttribute(attribute)).toBe(true);
    }
    expect(isPasswordAttribute('Simultaneous-Use')).toBe(false);
    expect(isPasswordAttribute('Framed-IP-Address')).toBe(false);
  });

  it('toRadiusGroup menjaga priority tetap number', () => {
    const group = toRadiusGroup({ id: 1, username: 'budi', groupname: 'home', priority: '2' as unknown as number });
    expect(group.priority).toBe(2);
    expect(group.groupname).toBe('home');
  });

  it('totalOctets menjumlahkan input+output dan menangani data kosong', () => {
    expect(totalOctets({ acctinputoctets: 100, acctoutputoctets: 250 })).toBe(350);
    expect(totalOctets({ acctinputoctets: 100, acctoutputoctets: null })).toBe(100);
    expect(totalOctets({ acctinputoctets: null, acctoutputoctets: null })).toBeNull();
  });

  it('acctstoptime NULL menandakan sesi aktif (dipakai query sesi)', () => {
    const sql = readMigration('004_freeradius_schema.sql');
    const fromSql = columnsOf(sql, 'radacct');
    expect(fromSql).toContain('acctstoptime');
    // Sesi aktif dikenali dari kolom ini bernilai NULL, bukan dari kolom status.
    expect(sql).toMatch(/acctstoptime\s+DATETIME\s+DEFAULT NULL/);
  });
});

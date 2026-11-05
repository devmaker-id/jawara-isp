import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

// CoA diuji ke jaringan sungguhan di e2e; di unit test ini cukup perilakunya.
// vi.mock di-hoist, jadi factory tidak boleh menyentuh variabel top-level.
vi.mock('../src/app/modules/freeradius/coa-probe', () => ({
  probeCoa: async () => ({
    status: 'nak' as const,
    reachable: true,
    detail: 'Disconnect-NAK (uji)',
    elapsed_ms: 3,
  }),
}));

import { RadiusService } from '../src/app/modules/freeradius/radius.service';
import { RADIUS_TABLES } from '../src/app/modules/freeradius/radius.repository';

const config = {
  database: { name: 'isp_billing_test' },
  freeradius: { host: '127.0.0.1', port: 1812, secret: 'rahasia', nas_address: '192.168.100.253' },
};

const makeService = (options: { tables?: string[] } = {}) => {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const repo = {
    existingTables: vi.fn(async () => options.tables ?? []),
    counts: vi.fn(async () => ({ nas: 2, users: 5, sessions: 1, groups: 3 })),
    lastAccountingAt: vi.fn(async () => '2026-10-25 07:00:00'),
    listNas: vi.fn(async () => ({ rows: [], total: 0 })),
    listNasAddresses: vi.fn(async () => [] as string[]),
    findNas: vi.fn(async (): Promise<{ id: number; nasname: string } | null> => null),
    createNas: vi.fn(async () => 11),
    updateNas: vi.fn(async () => undefined),
    deleteNas: vi.fn(async () => 1),
    countNasUsingAddress: vi.fn(async () => 0),
    nasReferences: vi.fn(async () => ({ accounting: 0, auth_log: 0 })),
    nasDeletionSnapshot: vi.fn(
      async (): Promise<{ nas: unknown[]; radacct: unknown[]; radpostauth: unknown[] }> => ({
        nas: [],
        radacct: [],
        radpostauth: [],
      }),
    ),
    purgeNas: vi.fn(async () => ({ accounting: 0, auth_log: 0, nas: 1 })),
    authLogReady: vi.fn(async () => true),
    authLog: vi.fn(async () => ({ rows: [], total: 0 })),
    authLogFacets: vi.fn(async () => ({ nas: [], interfaces: [], replies: [] })),
    listUsers: vi.fn(async () => ({ rows: [], total: 0 })),
    findUser: vi.fn(async (): Promise<{ id: number; username: string; password: string; groupname: string | null } | null> => null),
    createUser: vi.fn(async () => undefined),
    updateUser: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    sessions: vi.fn(async () => []),
    accounting: vi.fn(async () => []),
    findOwningProfile: vi.fn(
      async (): Promise<{ type: 'hotspot' | 'ppp'; id: number; name: string } | null> => null,
    ),
    countGroupUsers: vi.fn(async () => 0),
    deleteGroup: vi.fn(async () => 0),
  };
  const db = {
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      executed.push({ sql, params });
      return { affectedRows: 1 };
    }),
    query: vi.fn(async () => []),
  };
  const mikrotik = {
    listDevices: vi.fn(),
    radiusPreflight: vi.fn(),
    runWithDevice: vi.fn(async (_id: number, work: () => Promise<unknown>) => work()),
    provisionRadiusNas: vi.fn(),
    removeRadiusNas: vi.fn(async () => false),
  };
  const configService = { control: vi.fn(async () => ({ service: 'active' })) };
  const isolir = {
    syncGroupAttributes: vi.fn(async () => ({ group: 'ISOLIR', attributes: 0 })),
    provisionDevice: vi.fn(async () => undefined),
    ensureGroupRow: vi.fn(async () => 0),
  };
  const profiles = { removeProfile: vi.fn(async () => ({ id: 1, deleted: true })) };
  const service = new RadiusService(
    repo as never,
    config as never,
    db as never,
    mikrotik as never,
    configService as never,
    isolir as never,
    profiles as never,
  );
  return { service, repo, db, executed, mikrotik, configService, isolir, profiles };
};

const actor = { userId: 1, ip: '127.0.0.1' };

describe('RadiusService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('status jujur saat skema belum ada', async () => {
    const { service } = makeService({ tables: [] });

    const status = await service.status();

    expect(status.ready).toBe(false);
    expect(status.installed).toBe(false);
    expect(status.tables_missing).toEqual([...RADIUS_TABLES]);
    expect(status.message).toMatch(/004_freeradius_schema\.sql/);
  });

  it('status lengkap saat semua tabel ada', async () => {
    const { service } = makeService({ tables: [...RADIUS_TABLES] });

    const status = await service.status();

    expect(status.ready).toBe(true);
    expect(status.installed).toBe(true);
    expect(status.nas).toBe(2);
    expect(status.users).toBe(5);
    expect(status.active_sessions).toBe(1);
    expect(status.last_accounting_at).toBe('2026-10-25 07:00:00');
  });

  it('menolak operasi baca/tulis bila skema belum siap (503 + daftar tabel)', async () => {
    const { service, repo } = makeService({ tables: ['nas'] });

    await expect(service.listNas({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.createUser({ username: 'uji', password: 'rahasia' }, actor)).rejects.toThrow(
      /radcheck/,
    );
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('menolak NAS duplikat dengan 409', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });
    repo.countNasUsingAddress.mockResolvedValueOnce(1);

    await expect(
      service.createNas({ nasname: '192.168.100.254', secret: 'rahasia123' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createNas).not.toHaveBeenCalled();
  });

  it('membuat NAS dan mengembalikan id', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });

    const result = await service.createNas({ nasname: '192.168.100.254', secret: 'rahasia123' });

    // Hasil kini membawa bukti pemeriksaan: CoA dan status restart FreeRADIUS.
    expect(result).toMatchObject({ id: 11, nasname: '192.168.100.254', ros_version: '6' });
    expect(result.coa.status).toBe('nak');
    expect(result.radius_restarted).toBe(true);
    expect(repo.createNas).toHaveBeenCalledOnce();
  });

  it('menyiapkan /radius + CoA di perangkat sebelum NAS disimpan', async () => {
    const { service, repo, mikrotik } = makeService({ tables: [...RADIUS_TABLES] });
    mikrotik.radiusPreflight.mockResolvedValueOnce({
      device_id: 3,
      device_name: 'JMNET:GAJRUG',
      host: '10.200.10.242',
      identity: 'JMNET:GAJRUG',
      version: '6.49.22',
      ros_version: '6',
      clock: {
        date: 'oct/26/2026',
        time: '05:08:33',
        timezone: 'Asia/Jakarta',
        gmt_offset: '+07:00',
        drift_seconds: 2,
      },
      nas_address: '10.200.10.242',
      nas_address_source: 'management-host',
      incoming: { accept: false, port: 3799, read: true },
      existing_radius: [],
      reachability: { ok: true, tested: true, detail: '3 balasan' },
      server_address: '192.168.100.253',
    });
    mikrotik.provisionRadiusNas.mockResolvedValueOnce({
      created: true,
      updated: false,
      address: '192.168.100.253',
      service: 'ppp,hotspot',
      incoming_accept: true,
      incoming_port: 3799,
    });

    const result = await service.createNas({ device_id: 3, secret: 'rahasia123' });

    expect(mikrotik.provisionRadiusNas).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '192.168.100.253',
        secret: 'rahasia123',
        coaPort: 3799,
      }),
    );
    expect(result.provision).toMatchObject({ created: true, incoming_accept: true });
    expect(result.nasname).toBe('10.200.10.242');
    expect(repo.createNas).toHaveBeenCalledOnce();
  });

  it('menolak user duplikat dan mencatat audit saat berhasil', async () => {
    const { service, repo, executed } = makeService({ tables: [...RADIUS_TABLES] });

    repo.findUser.mockResolvedValueOnce({
      id: 1,
      username: 'budi',
      password: 'x',
      groupname: null,
    });
    await expect(
      service.createUser({ username: 'budi', password: 'rahasia' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);

    repo.findUser.mockResolvedValueOnce(null);
    await service.createUser({ username: 'budi', password: 'rahasia', group: 'vip' }, actor);

    expect(repo.createUser).toHaveBeenCalledOnce();
    expect(executed[0].sql).toContain('INSERT INTO audit_logs');
    expect(executed[0].params[0]).toBe(1);
    expect(String(executed[0].params[1])).toBe('RADIUS_USER_CREATED');
  });

  it('user yang tidak ada → 404', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });

    await expect(service.deleteUser('hantu', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.deleteUser).not.toHaveBeenCalled();
  });

  it('menolak hapus NAS yang masih punya riwayat, dengan pesan yang bisa dibaca', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });
    repo.findNas.mockResolvedValueOnce({ id: 15, nasname: '10.200.10.242' });
    repo.nasReferences.mockResolvedValueOnce({ accounting: 42, auth_log: 7 });

    const error = await service.deleteNas(15).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'NAS_HAS_HISTORY',
      confirm_word: 'setuju',
      impact: { accounting: 42, auth_log: 7 },
    });
    expect((error as Error).message).toMatch(/42 baris akuntansi/);
    expect((error as Error).message).toMatch(/7 baris log autentikasi/);
    expect(repo.purgeNas).not.toHaveBeenCalled();
    expect(repo.deleteNas).not.toHaveBeenCalled();
  });

  it('hapus NAS berjejak dengan konfirmasi "setuju": cadangkan dulu, lalu hapus sesi+log+nas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nas-backup-'));
    const previous = process.env.RADIUS_BACKUP_DIR;
    process.env.RADIUS_BACKUP_DIR = dir;
    try {
      const { service, repo, mikrotik } = makeService({ tables: [...RADIUS_TABLES] });
      repo.findNas.mockResolvedValueOnce({ id: 15, nasname: '10.200.10.242' });
      repo.nasReferences.mockResolvedValueOnce({ accounting: 42, auth_log: 7 });
      mikrotik.listDevices.mockResolvedValueOnce({ rows: [] });
      repo.nasDeletionSnapshot.mockResolvedValueOnce({
        nas: [{ id: 15, nasname: '10.200.10.242' }],
        radacct: [{ radacctid: 1, nasipaddress: '10.200.10.242' }],
        radpostauth: [{ id: 1, nasipaddress: '10.200.10.242' }],
      });
      repo.purgeNas.mockResolvedValueOnce({ accounting: 42, auth_log: 7, nas: 1 });

      const result = await service.deleteNas(15, 'setuju');

      // Cadangan harus sudah ada di disk sebelum purge dipanggil.
      expect(repo.nasDeletionSnapshot).toHaveBeenCalledWith(15, '10.200.10.242');
      expect(repo.purgeNas).toHaveBeenCalledWith(15, '10.200.10.242');
      expect(repo.deleteNas).not.toHaveBeenCalled();
      expect(result.removed).toMatchObject({ accounting: 42, auth_log: 7 });

      const file = readFileSync(String(result.backup));
      const isi = JSON.parse(gunzipSync(file).toString());
      expect(isi.nasname).toBe('10.200.10.242');
      expect(isi.jumlah).toEqual({ accounting: 42, auth_log: 7 });
      expect(isi.radacct).toHaveLength(1);
      expect(statSync(String(result.backup)).mode & 0o777).toBe(0o600);
    } finally {
      if (previous === undefined) delete process.env.RADIUS_BACKUP_DIR;
      else process.env.RADIUS_BACKUP_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tidak menghapus apa pun bila cadangan gagal ditulis', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nas-backup-'));
    const previous = process.env.RADIUS_BACKUP_DIR;
    // Berkas biasa, bukan direktori → penulisan cadangan pasti gagal.
    const blocked = join(dir, 'bukan-direktori');
    writeFileSync(blocked, 'x');
    process.env.RADIUS_BACKUP_DIR = blocked;
    try {
      const { service, repo, mikrotik } = makeService({ tables: [...RADIUS_TABLES] });
      repo.findNas.mockResolvedValueOnce({ id: 15, nasname: '10.200.10.242' });
      repo.nasReferences.mockResolvedValueOnce({ accounting: 42, auth_log: 0 });
      mikrotik.listDevices.mockResolvedValueOnce({ rows: [] });

      await expect(service.deleteNas(15, 'setuju')).rejects.toThrow(/belum dihapus/);
      expect(repo.purgeNas).not.toHaveBeenCalled();
      expect(repo.deleteNas).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.RADIUS_BACKUP_DIR;
      else process.env.RADIUS_BACKUP_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('menghapus /radius di perangkat saat NAS dihapus', async () => {
    const { service, repo, mikrotik } = makeService({ tables: [...RADIUS_TABLES] });
    repo.findNas.mockResolvedValueOnce({ id: 15, nasname: '10.200.10.242' });
    mikrotik.listDevices.mockResolvedValueOnce({
      rows: [{ id: 3, name: 'JMNET:GAJRUG', host: '10.200.10.242' }],
    });
    mikrotik.removeRadiusNas.mockResolvedValueOnce(true);

    const result = await service.deleteNas(15);

    expect(mikrotik.removeRadiusNas).toHaveBeenCalledWith('192.168.100.253');
    expect(result.device).toMatchObject({ device_id: 3, removed: true });
    expect(repo.deleteNas).toHaveBeenCalledWith(15);
  });

  it('tidak menghapus NAS bila pembersihan perangkat gagal', async () => {
    const { service, repo, mikrotik } = makeService({ tables: [...RADIUS_TABLES] });
    repo.findNas.mockResolvedValueOnce({ id: 15, nasname: '10.200.10.242' });
    mikrotik.listDevices.mockResolvedValueOnce({
      rows: [{ id: 3, name: 'JMNET:GAJRUG', host: '10.200.10.242' }],
    });
    mikrotik.removeRadiusNas.mockRejectedValueOnce(
      new Error('Tulis ke perangkat dinonaktifkan'),
    );

    await expect(service.deleteNas(15)).rejects.toThrow(/gagal dibersihkan/);
    expect(repo.deleteNas).not.toHaveBeenCalled();
  });

  it('log autentikasi menolak database tanpa kolom migrasi 011', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });
    repo.authLogReady.mockResolvedValueOnce(false);

    await expect(service.authLog({})).rejects.toThrow(/011_radius_auth_log/);
    expect(repo.authLog).not.toHaveBeenCalled();
  });

  it('log autentikasi meng-clamp limit dan mengembalikan facet filter', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });

    const result = await service.authLog({ limit: 9999, page: 2, mac: 'AA:BB' });

    expect(repo.authLog).toHaveBeenCalledWith(expect.objectContaining({ limit: 500, offset: 500, mac: 'AA:BB' }));
    expect(result).toMatchObject({ page: 2, limit: 500, total: 0 });
    expect(result.facets).toEqual({ nas: [], interfaces: [], replies: [] });
  });

  it('membaca sesi dengan batas limit yang di-clamp', async () => {
    const { service, repo } = makeService({ tables: [...RADIUS_TABLES] });

    await service.sessions('9999');
    expect(repo.sessions).toHaveBeenCalledWith(9999);
  });

  it('hapus grup milik profil layanan diteruskan ke profil (cascade)', async () => {
    const { service, repo, profiles } = makeService({ tables: [...RADIUS_TABLES] });
    repo.findOwningProfile.mockResolvedValueOnce({ type: 'hotspot', id: 9, name: 'agen' });
    repo.deleteGroup.mockResolvedValueOnce(2);

    const result = await service.deleteGroup('agen', actor);

    expect(profiles.removeProfile).toHaveBeenCalledWith(actor, 'hotspot', 9);
    expect(repo.deleteGroup).toHaveBeenCalledWith('agen');
    expect(result.profile_deleted).toEqual({ type: 'hotspot', id: 9, name: 'agen' });
    expect(result.removed_users).toBe(2);
  });

  it('hapus grup mandiri tetap menghapus baris radgroup langsung', async () => {
    const { service, repo, profiles } = makeService({ tables: [...RADIUS_TABLES] });
    repo.findOwningProfile.mockResolvedValueOnce(null);
    repo.deleteGroup.mockResolvedValueOnce(3);

    const result = await service.deleteGroup('CUSTOM', actor);

    expect(repo.deleteGroup).toHaveBeenCalledWith('CUSTOM');
    expect(profiles.removeProfile).not.toHaveBeenCalled();
    expect(result.removed_users).toBe(3);
  });
});
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../src/app/modules/mikrotik/crypto';
import { MikrotikService } from '../src/app/modules/mikrotik/mikrotik.service';
import type { MikrotikDeviceRow } from '../src/app/modules/mikrotik/mikrotik-devices.repository';
import { RouterOsClient, RouterOsError } from '../src/app/modules/mikrotik/routeros.client';

// CRUD perangkat MikroTik diuji dengan repository palsu di memori dan client
// RouterOS di-spy: tidak ada koneksi ke router dan tidak ada tulisan ke DB.
const SECRET_KEY = 'kunci-tes-perangkat-mikrotik';
const actor = { userId: 1, ip: '127.0.0.1' };

const row = (overrides: Partial<MikrotikDeviceRow> = {}): MikrotikDeviceRow => ({
  id: 1,
  name: 'Nanggela',
  host: '192.168.100.254',
  api_port: 1998,
  api_user: 'hermes',
  api_password: encryptSecret('rahasia-api', SECRET_KEY),
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

const makeFakeRepo = (options: { rows?: MikrotikDeviceRow[]; hasTable?: boolean } = {}) => {
  const store = new Map<number, MikrotikDeviceRow>();
  for (const item of options.rows ?? []) store.set(item.id, item);
  let nextId = Math.max(0, ...[...store.keys()]) + 1;
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ id: number; data: Record<string, unknown> }> = [];
  const removed: number[] = [];
  const statuses: Array<{ id: number; result: Record<string, unknown> }> = [];

  const repo = {
    hasTable: async () => options.hasTable ?? true,
    list: async () => [...store.values()].sort((a, b) => a.id - b.id),
    find: async (id: number) => store.get(id) ?? null,
    findByName: async (name: string, exceptId?: number) =>
      [...store.values()].find((item) => item.name === name && item.id !== exceptId) ?? null,
    firstActive: async () => [...store.values()].find((item) => item.is_active === 1) ?? null,
    create: async (data: Record<string, unknown>) => {
      created.push(data);
      store.set(nextId, row({ id: nextId, ...(data as never) }));
      return nextId++;
    },
    update: async (id: number, data: Record<string, unknown>) => {
      updated.push({ id, data });
      const current = store.get(id);
      if (current) store.set(id, { ...current, ...(data as never) });
    },
    remove: async (id: number) => {
      removed.push(id);
      store.delete(id);
    },
    touchStatus: async (id: number, result: Record<string, unknown>) => {
      statuses.push({ id, result });
    },
    forgetSchemaCache: () => undefined,
  };

  return { repo, store, created, updated, removed, statuses };
};

const makeDb = () => {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    db: {
      query: async () => [],
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params });
        return { affectedRows: 1 };
      },
    },
  };
};

const makeService = (fake: ReturnType<typeof makeFakeRepo>) => {
  const { db, executed } = makeDb();
  const service = new MikrotikService(
    { secretKey: SECRET_KEY, getMikrotikConfig: async () => ({ host: '', port: 1998, user: '', password: '' }) } as never,
    db as never,
    fake.repo as never,
  );
  return { service, executed };
};

describe('MikrotikService — daftar perangkat', () => {
  afterEach(() => vi.restoreAllMocks());

  it('melaporkan belum siap (bukan angka nol palsu) saat tabel belum ada', async () => {
    const fake = makeFakeRepo({ hasTable: false });
    const { service } = makeService(fake);

    const result = await service.listDevices();

    expect(result.ready).toBe(false);
    expect(result.migration).toBe('005_mikrotik_devices.sql');
    expect(result.rows).toEqual([]);
  });

  it('mengembalikan perangkat tanpa pernah membocorkan password', async () => {
    const fake = makeFakeRepo({ rows: [row(), row({ id: 2, name: 'Cabang', api_password: '' })] });
    const { service } = makeService(fake);

    const result = await service.listDevices();
    const serialized = JSON.stringify(result);

    expect(result.ready).toBe(true);
    expect(result.default_device_id).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].password_set).toBe(true);
    expect(result.rows[0].password_encrypted).toBe(true);
    expect(result.rows[1].password_set).toBe(false);
    expect(serialized).not.toContain('rahasia-api');
    expect(serialized).not.toContain('api_password');
  });

  it('menyimpan password baru dalam bentuk terenkripsi + audit', async () => {
    const fake = makeFakeRepo();
    const { service, executed } = makeService(fake);

    const created = await service.createDevice(
      { name: 'Router Baru', host: '10.0.0.1', api_user: 'admin', api_password: 'sangat-rahasia' },
      actor,
    );

    expect(created?.id).toBe(1);
    const payload = fake.created[0];
    expect(String(payload.api_password)).toMatch(/^v1:/);
    expect(String(payload.api_password)).not.toContain('sangat-rahasia');
    expect(payload.api_port).toBe(1998);
    expect(executed.some((item) => item.params[1] === 'MIKROTIK_DEVICE_CREATED')).toBe(true);
  });

  it('menolak nama perangkat yang sudah dipakai (409)', async () => {
    const fake = makeFakeRepo({ rows: [row()] });
    const { service } = makeService(fake);

    await expect(
      service.createDevice({ name: 'Nanggela', host: '10.0.0.2', api_user: 'admin' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fake.created).toHaveLength(0);
  });

  it('update tanpa password tidak mengubah kredensial tersimpan', async () => {
    const fake = makeFakeRepo({ rows: [row()] });
    const { service } = makeService(fake);
    const before = String(fake.store.get(1)?.api_password);

    await service.updateDevice(1, { host: '10.9.9.9', api_password: '' }, actor);

    const after = String(fake.store.get(1)?.api_password);
    expect(after).toBe(before);
    expect(fake.updated[0].data.api_password).toBeUndefined();
    expect(fake.store.get(1)?.host).toBe('10.9.9.9');
  });

  it('update dengan password baru menulis ciphertext, bukan teks biasa', async () => {
    const fake = makeFakeRepo({ rows: [row()] });
    const { service } = makeService(fake);

    await service.updateDevice(1, { api_password: 'password-baru' }, actor);

    const stored = String(fake.store.get(1)?.api_password);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('password-baru');
  });

  it('menolak update perangkat yang tidak ada (404)', async () => {
    const fake = makeFakeRepo();
    const { service } = makeService(fake);
    await expect(service.updateDevice(99, { host: '10.0.0.1' }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('menghapus perangkat + menulis audit', async () => {
    const fake = makeFakeRepo({ rows: [row()] });
    const { service, executed } = makeService(fake);

    const result = await service.deleteDevice(1, actor);

    expect(result.deleted).toBe(true);
    expect(fake.removed).toEqual([1]);
    expect(executed.some((item) => item.params[1] === 'MIKROTIK_DEVICE_DELETED')).toBe(true);
  });

  it('CRUD ditolak 503 bila tabel belum ada', async () => {
    const fake = makeFakeRepo({ hasTable: false });
    const { service } = makeService(fake);

    await expect(
      service.createDevice({ name: 'X Router', host: '10.0.0.1', api_user: 'admin' }, actor),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('MikrotikService — target perangkat', () => {
  afterEach(() => vi.restoreAllMocks());

  it('memakai kredensial perangkat terpilih dan mendekripsi password', async () => {
    const fake = makeFakeRepo({ rows: [row(), row({ id: 2, name: 'Cabang', host: '10.0.0.9' })] });
    const { service } = makeService(fake);

    const target = await service.target(2);

    expect(target.device_id).toBe(2);
    expect(target.device_name).toBe('Cabang');
    expect(target.source).toBe('device');
    expect(target.host).toBe('10.0.0.9');
    expect(target.password).toBe('rahasia-api');
  });

  it('tanpa parameter memakai perangkat aktif pertama', async () => {
    const fake = makeFakeRepo({ rows: [row({ id: 3, name: 'Default' })] });
    const { service } = makeService(fake);

    const target = await service.target();

    expect(target.device_id).toBe(3);
    expect(target.device_name).toBe('Default');
  });

  it('menolak id perangkat yang tidak dikenal (404) dan nonaktif (503)', async () => {
    const fake = makeFakeRepo({ rows: [row({ id: 5, is_active: 0 })] });
    const { service } = makeService(fake);

    await expect(service.target(99)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.target(5)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('runWithDevice menolak id bukan angka positif', async () => {
    const fake = makeFakeRepo();
    const { service } = makeService(fake);
    expect(() => service.runWithDevice(Number('abc') as never, async () => 'x')).toThrow(
      BadRequestException,
    );
  });
});

describe('MikrotikService — uji koneksi perangkat', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mencatat identitas dan status terhubung saat login berhasil', async () => {
    const fake = makeFakeRepo({ rows: [row()] });
    const { service, executed } = makeService(fake);
    vi.spyOn(RouterOsClient.prototype, 'executeEach').mockResolvedValue([
      { records: [{ name: 'BIBIT::NANGGELA' }], traps: [] },
      { records: [{ version: '6.49.22', 'board-name': 'RB1100AHx4', uptime: '1w2d' }], traps: [] },
    ]);

    const result = await service.testDevice(1, actor);

    expect(result.connected).toBe(true);
    expect(result.identity).toBe('BIBIT::NANGGELA');
    expect(result.version).toBe('6.49.22');
    expect(fake.statuses[0].result).toMatchObject({ connected: true, identity: 'BIBIT::NANGGELA' });
    expect(executed.some((item) => item.params[1] === 'MIKROTIK_DEVICE_TESTED')).toBe(true);
  });

  it('mengembalikan pesan yang bisa dibaca saat login ditolak, bukan 500', async () => {
    const fake = makeFakeRepo({ rows: [row()] });
    const { service } = makeService(fake);
    vi.spyOn(RouterOsClient.prototype, 'executeEach').mockRejectedValue(
      new RouterOsError('Login API MikroTik ditolak', 'login', 'invalid user name or password'),
    );

    const result = await service.testDevice(1, actor);

    expect(result.connected).toBe(false);
    expect(result.message).toMatch(/Login API MikroTik ditolak/);
    expect(fake.statuses[0].result).toMatchObject({ connected: false });
  });
});
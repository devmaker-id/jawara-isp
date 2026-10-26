import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MikrotikService } from '../src/app/modules/mikrotik/mikrotik.service';
import { RouterOsClient, RouterOsError } from '../src/app/modules/mikrotik/routeros.client';

// Tes pemetaan service: client RouterOS di-spy, database dan konfigurasi
// diganti objek palsu. Tidak ada koneksi ke router sungguhan.
const config = {
  getMikrotikConfig: async () => ({
    host: '192.168.100.254',
    port: 1998,
    user: 'hermes',
    password: 'rahasia',
  }),
  database: { name: 'isp_billing_test' },
  freeradius: { host: '127.0.0.1', port: 1812, secret: 'x' },
  mikrotik: { host: '192.168.100.254', port: 1998, user: 'hermes', password: 'rahasia' },
  secretKey: 'kunci-tes-jangan-dipakai',
};

// Tabel mikrotik_devices belum ada di tes unit: service harus jatuh ke
// konfigurasi tunggal lama (perilaku yang diuji di sini).
const makeDevices = (overrides: Partial<Record<string, unknown>> = {}) => ({
  hasTable: async () => false,
  list: async () => [],
  find: async () => null,
  findByName: async () => null,
  firstActive: async () => null,
  create: async () => 1,
  update: async () => undefined,
  remove: async () => undefined,
  touchStatus: async () => undefined,
  forgetSchemaCache: () => undefined,
  ...overrides,
});

const makeDb = (options: { writeEnabled?: boolean; guiUrl?: string } = {}) => {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    db: {
      query: async () => [
        { config_key: 'mikrotik_write_enabled', config_value: options.writeEnabled ? '1' : '0' },
        { config_key: 'mikrotik_gui_url', config_value: options.guiUrl ?? '' },
      ],
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params });
        return { affectedRows: 1 };
      },
    },
  };
};

const makeService = (options: { writeEnabled?: boolean; guiUrl?: string } = {}) => {
  const { db, executed } = makeDb(options);
  const service = new MikrotikService(config as never, db as never, makeDevices() as never);
  return { service, executed };
};

const records = (...rows: Record<string, string>[]) => ({ records: rows, traps: [] });

describe('MikrotikService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('memetakan resource ke MB dan detik uptime', async () => {
    vi.spyOn(RouterOsClient.prototype, 'executeEach').mockResolvedValue([
      records({
        version: '6.49.22 (long-term)',
        'board-name': 'RB1100AHx4',
        'architecture-name': 'arm',
        uptime: '1w2d03:04:05',
        'cpu-load': '7',
        'cpu-count': '4',
        'total-memory': String(1024 * 1024 * 1024),
        'free-memory': String(512 * 1024 * 1024),
        'total-hdd-space': String(128 * 1024 * 1024),
        'free-hdd-space': String(64 * 1024 * 1024),
      }),
      records({ name: 'BIBIT::NANGGELA' }),
      records({ model: 'RB1100AHx4' }),
    ]);
    const { service } = makeService();

    const result = await service.resources();

    expect(result.identity).toBe('BIBIT::NANGGELA');
    expect(result.memory_total_mb).toBe(1024);
    expect(result.memory_free_mb).toBe(512);
    expect(result.memory_used_mb).toBe(512);
    expect(result.uptime_seconds).toBe(604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(result.cpu_load).toBe(7);
    expect(result.board).toBe('RB1100AHx4');
  });

  it('memetakan interface, mengurutkan nama, dan membaca flag disabled', async () => {
    vi.spyOn(RouterOsClient.prototype, 'executeEach').mockResolvedValue([
      records(
        { '.id': '*2', name: 'vlan302', type: 'vlan', mtu: '1500', disabled: 'true' },
        { '.id': '*1', name: 'ether1', type: 'ether', mtu: '1500', running: 'true', 'rx-byte': '1024' },
      ),
    ]);
    const { service } = makeService();

    const result = await service.interfaces();

    expect(result.map((row) => row.name)).toEqual(['ether1', 'vlan302']);
    expect(result[0].running).toBe(true);
    expect(result[0].rx_bytes).toBe(1024);
    expect(result[1].disabled).toBe(true);
  });

  it('memfilter user hotspot berdasarkan pencarian dan profil', async () => {
    vi.spyOn(RouterOsClient.prototype, 'executeEach').mockResolvedValue([
      records(
        { '.id': '*1', name: 'budi', profile: 'default', comment: 'pelanggan 1' },
        { '.id': '*2', name: 'siti', profile: 'vip', comment: 'pelanggan 2' },
      ),
    ]);
    const { service } = makeService();

    const bySearch = await service.hotspotUsers({ search: 'budi' });
    const byProfile = await service.hotspotUsers({ profile: 'vip' });

    expect(bySearch.map((row) => row.name)).toEqual(['budi']);
    expect(byProfile.map((row) => row.name)).toEqual(['siti']);
  });

  it('menolak tulis bila mode tulis belum diaktifkan', async () => {
    const spy = vi.spyOn(RouterOsClient.prototype, 'executeEach');
    const { service } = makeService({ writeEnabled: false });

    await expect(
      service.createHotspotUser(
        { name: 'uji', password: 'uji' },
        { userId: 1, ip: '127.0.0.1' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(spy).not.toHaveBeenCalled();
  });

  it('mengirim perintah add dan menulis audit saat mode tulis aktif', async () => {
    const spy = vi
      .spyOn(RouterOsClient.prototype, 'executeEach')
      .mockResolvedValue([records({ ret: '*3' })]);
    const { service, executed } = makeService({ writeEnabled: true });

    await service.createHotspotUser(
      { name: 'uji', password: 'rahasia', profile: 'default' },
      { userId: 7, ip: '10.0.0.1' },
    );

    const sent = spy.mock.calls[0][0][0];
    expect(sent[0]).toBe('/ip/hotspot/user/add');
    expect(sent).toContain('=name=uji');
    expect(sent).toContain('=password=rahasia');
    expect(executed[0].sql).toContain('INSERT INTO audit_logs');
    expect(executed[0].params[0]).toBe(7);
    expect(String(executed[0].params[1])).toBe('MIKROTIK_HOTSPOT_USER_CREATED');
  });

  it('provisioning menulis timeout 3s dan mengaktifkan radius di layanan', async () => {
    const { service } = makeService({ writeEnabled: true });
    const calls: string[][] = [];
    let radiusReads = 0;
    vi.spyOn(RouterOsClient.prototype, 'execute').mockImplementation(async (commands) => {
      const words = commands[0] as string[];
      calls.push(words);
      switch (words[0]) {
        case '/radius/print':
          radiusReads += 1;
          // Panggilan pertama: belum ada entri. Panggilan verifikasi: sudah ada.
          return records(
            ...(radiusReads > 1
              ? [{ '.id': '*1', address: '192.168.100.253', service: 'ppp,hotspot' }]
              : []),
          );
        case '/radius/incoming/print':
          return records({ accept: 'true', port: '3799' });
        case '/ppp/aaa/print':
          return records({ 'use-radius': 'false' });
        case '/ip/hotspot/print':
          return records({ name: 'JMNET-GAJRUG', profile: 'hs-gajrug' });
        case '/ip/hotspot/profile/print':
          return records({ '.id': '*0', name: 'hs-gajrug', 'use-radius': 'false' });
        default:
          return records();
      }
    });

    const result = await service.provisionRadiusNas({
      address: '192.168.100.253',
      secret: 'rahasia123',
      authPort: 1812,
      acctPort: 1813,
      coaPort: 3799,
    });

    const add = calls.find((words) => words[0] === '/radius/add') ?? [];
    expect(add).toContain('=timeout=3s');
    expect(add).toContain('=secret=rahasia123');
    expect(calls.some((words) => words[0] === '/ppp/aaa/set' && words.includes('=use-radius=yes'))).toBe(true);
    expect(
      calls.some((words) => words[0] === '/ip/hotspot/profile/set' && words.includes('=.id=*0')),
    ).toBe(true);
    expect(result.services.ppp_aaa).toEqual({ use_radius: true, changed: true });
    expect(result.services.hotspot_profiles).toEqual([{ name: 'hs-gajrug', changed: true }]);
  });

  it('menerjemahkan trap RouterOS menjadi 400 dan koneksi gagal menjadi 503', async () => {
    const { service } = makeService();
    const spy = vi.spyOn(RouterOsClient.prototype, 'executeEach');

    spy.mockRejectedValueOnce(new RouterOsError('ditolak', 'trap', 'no such item'));
    await expect(service.routingRoutes()).rejects.toBeInstanceOf(BadRequestException);

    spy.mockRejectedValueOnce(new RouterOsError('tidak terjangkau', 'connection', 'ECONNREFUSED'));
    await expect(service.routingRoutes()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('status mengembalikan connected=false beserta pesan saat perangkat tidak bisa dibaca', async () => {
    vi.spyOn(RouterOsClient.prototype, 'executeEach').mockRejectedValue(
      new RouterOsError('Timeout 8000 ms pada /system/identity/print', 'timeout'),
    );
    const { service } = makeService();

    const status = await service.status();

    expect(status.configured).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.message).toMatch(/Timeout/);
  });

  it('status mengembalikan configured=false bila host belum diisi', async () => {
    const service = new MikrotikService(
      { ...config, getMikrotikConfig: async () => ({ host: '', port: 1998, user: '', password: '' }) } as never,
      makeDb().db as never,
      makeDevices() as never,
    );

    const status = await service.status();

    expect(status.configured).toBe(false);
    expect(status.gui_url).toBe('');
    expect(status.message).toMatch(/belum ada perangkat|belum diisi/i);
  });
});
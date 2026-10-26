import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { MikrotikService } from './../src/app/modules/mikrotik/mikrotik.service.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';

// Endpoint MikroTik diuji lewat HTTP dengan MikrotikService palsu: tidak ada
// koneksi ke perangkat dan tidak ada penulisan ke database.
describe('Mikrotik (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const fakeMikrotik = {
    status: async () => {
      calls.push({ method: 'status', args: [] });
      return {
        configured: true,
        connected: true,
        host: '192.168.100.254',
        port: 1998,
        gui_url: 'http://192.168.100.254',
        write_enabled: false,
        identity: 'BIBIT::NANGGELA',
        version: '6.49.22',
        interfaces: { total: 65, running: 20, disabled: 3 },
      };
    },
    resources: async () => ({ memory_total_mb: 1024, cpu_load: 7, uptime_seconds: 100 }),
    interfaces: async () => [{ id: '*1', name: 'ether1', type: 'ether', running: true }],
    hotspotServers: async () => [{ id: '*1', name: 'hs-1' }],
    hotspotProfiles: async () => [{ id: '*1', name: 'default' }],
    hotspotUsers: async (query: Record<string, unknown>) => {
      calls.push({ method: 'hotspotUsers', args: [query] });
      return [{ id: '*1', name: 'budi' }];
    },
    hotspotActive: async () => [{ id: '*1', user: 'budi' }],
    createHotspotUser: async (dto: unknown, actor: unknown) => {
      calls.push({ method: 'createHotspotUser', args: [dto, actor] });
      return { ok: true };
    },
    updateHotspotUser: async (id: string, dto: unknown, actor: unknown) => {
      calls.push({ method: 'updateHotspotUser', args: [id, dto, actor] });
      return { ok: true, id };
    },
    deleteHotspotUser: async (id: string) => ({ ok: true, id }),
    pppProfiles: async () => [{ id: '*1', name: 'default' }],
    pppSecrets: async () => [{ id: '*1', name: 'pppoe-budi' }],
    pppActive: async () => [{ id: '*1', name: 'pppoe-budi' }],
    createPppSecret: async (dto: unknown) => ({ ok: true, name: (dto as { name: string }).name }),
    updatePppSecret: async (id: string) => ({ ok: true, id }),
    deletePppSecret: async (id: string) => ({ ok: true, id }),
    routingRoutes: async () => [{ id: '*1', dst_address: '0.0.0.0/0' }],
    routingNeighbors: async () => [],
    routingArp: async () => [],
    setInterfaceDisabled: async (name: string, dto: unknown, actor: unknown) => {
      calls.push({ method: 'setInterfaceDisabled', args: [name, dto, actor] });
      return { ok: true, name };
    },
    runWithDevice: async (deviceId: unknown, work: () => Promise<unknown>) => {
      calls.push({ method: 'runWithDevice', args: [deviceId] });
      return work();
    },
    listDevices: async () => {
      calls.push({ method: 'listDevices', args: [] });
      return {
        ready: true,
        migration: '005_mikrotik_devices.sql',
        default_device_id: 1,
        rows: [
          {
            id: 1,
            name: 'Nanggela',
            host: '192.168.100.254',
            api_port: 1998,
            api_user: 'hermes',
            gui_url: null,
            description: null,
            write_enabled: false,
            is_active: true,
            password_set: true,
            password_encrypted: true,
            last_checked_at: null,
            last_connected: true,
            last_message: 'Terhubung',
            last_identity: 'BIBIT::NANGGELA',
            created_at: null,
            updated_at: null,
          },
        ],
      };
    },
    createDevice: async (dto: Record<string, unknown>, actor: unknown) => {
      calls.push({ method: 'createDevice', args: [dto, actor] });
      return {
        id: 2,
        name: dto.name,
        host: dto.host,
        api_port: dto.api_port ?? 1998,
        api_user: dto.api_user,
        password_set: Boolean(dto.api_password),
        password_encrypted: true,
        is_active: true,
        write_enabled: Boolean(dto.write_enabled),
      };
    },
    updateDevice: async (id: number, dto: Record<string, unknown>, actor: unknown) => {
      calls.push({ method: 'updateDevice', args: [id, dto, actor] });
      return {
        id,
        name: dto.name ?? 'Nanggela',
        host: dto.host ?? '192.168.100.254',
        api_port: 1998,
        api_user: 'hermes',
        password_set: true,
        password_encrypted: true,
        is_active: true,
        write_enabled: false,
      };
    },
    deleteDevice: async (id: number, actor: unknown) => {
      calls.push({ method: 'deleteDevice', args: [id, actor] });
      return { deleted: true, id };
    },
    testDevice: async (id: number, actor: unknown) => {
      calls.push({ method: 'testDevice', args: [id, actor] });
      return {
        id,
        name: 'Nanggela',
        host: '192.168.100.254',
        port: 1998,
        connected: true,
        message: 'Terhubung',
        identity: 'BIBIT::NANGGELA',
        version: '6.49.22',
        latency_ms: 42,
      };
    },
  };

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(MikrotikService)
      .useValue(fakeMikrotik)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const secret = app.get(ConfigService).jwtSecret;
    const sign = (sub: number, role: string, email: string) =>
      new JwtService().sign({ sub, email, role }, { secret, expiresIn: '1h' });

    adminToken = sign(1, 'admin', 'admin@uji.test');
    operatorToken = sign(2, 'operator', 'operator@uji.test');
    resellerToken = sign(3, 'resseler', 'reseller@uji.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('tanpa token → 401', async () => {
    await api().get('/api/mikrotik/status').expect(401);
  });

  it('reseller tidak boleh mengakses halaman perangkat → 403', async () => {
    for (const path of [
      '/api/mikrotik/status',
      '/api/mikrotik/interfaces',
      '/api/mikrotik/hotspot/users',
      '/api/mikrotik/ppp/secrets',
      '/api/mikrotik/routing/routes',
    ]) {
      await api().get(path).set(auth(resellerToken)).expect(403);
    }
  });

  it('operator dan admin boleh membaca status, interface, hotspot, ppp, routing', async () => {
    const paths = [
      '/api/mikrotik/status',
      '/api/mikrotik/resources',
      '/api/mikrotik/interfaces',
      '/api/mikrotik/hotspot/servers',
      '/api/mikrotik/hotspot/profiles',
      '/api/mikrotik/hotspot/users',
      '/api/mikrotik/hotspot/active',
      '/api/mikrotik/ppp/profiles',
      '/api/mikrotik/ppp/secrets',
      '/api/mikrotik/ppp/active',
      '/api/mikrotik/routing/routes',
      '/api/mikrotik/routing/neighbors',
      '/api/mikrotik/routing/arp',
    ];
    for (const token of [adminToken, operatorToken]) {
      for (const path of paths) {
        const response = await api().get(path).set(auth(token));
        expect(response.status, `${path} dengan token ${token.slice(0, 6)}…`).toBe(200);
      }
    }
  });

  it('meneruskan filter pencarian user hotspot ke service', async () => {
    calls.length = 0;
    await api()
      .get('/api/mikrotik/hotspot/users?search=budi&profile=default')
      .set(auth(operatorToken))
      .expect(200);

    // runWithDevice dicatat lebih dulu oleh wrapper perangkat.
    const forwarded = calls.find((entry) => entry.method === 'hotspotUsers');
    expect(forwarded).toEqual({
      method: 'hotspotUsers',
      args: [{ search: 'budi', profile: 'default', server: undefined, disabled: undefined }],
    });
  });

  it('operator tidak boleh menulis (hanya admin)', async () => {
    await api()
      .post('/api/mikrotik/hotspot/users')
      .set(auth(operatorToken))
      .send({ name: 'uji', password: 'uji' })
      .expect(403);

    await api()
      .delete('/api/mikrotik/hotspot/users/*1')
      .set(auth(operatorToken))
      .expect(403);

    await api()
      .patch('/api/mikrotik/interfaces/ether1')
      .set(auth(operatorToken))
      .send({ disabled: true })
      .expect(403);
  });

  it('admin boleh membuat user hotspot dan aktor diteruskan', async () => {
    calls.length = 0;
    await api()
      .post('/api/mikrotik/hotspot/users')
      .set(auth(adminToken))
      .send({ name: 'uji.hotspot', password: 'rahasia', profile: 'default' })
      .expect(201);

    const call = calls.find((entry) => entry.method === 'createHotspotUser');
    expect(call).toBeTruthy();
    expect((call?.args[0] as { name: string }).name).toBe('uji.hotspot');
    expect((call?.args[1] as { userId: number }).userId).toBe(1);
  });

  it('validasi nama user menolak karakter aneh dan nama kosong', async () => {
    await api()
      .post('/api/mikrotik/hotspot/users')
      .set(auth(adminToken))
      .send({ name: 'user dengan spasi' })
      .expect(400);

    await api()
      .post('/api/mikrotik/hotspot/users')
      .set(auth(adminToken))
      .send({ name: '' })
      .expect(400);
  });

  it('validasi service PPP hanya menerima nilai yang dikenal', async () => {
    await api()
      .post('/api/mikrotik/ppp/secrets')
      .set(auth(adminToken))
      .send({ name: 'pppoe-uji', service: 'wireguard' })
      .expect(400);

    await api()
      .post('/api/mikrotik/ppp/secrets')
      .set(auth(adminToken))
      .send({ name: 'pppoe-uji', service: 'pppoe' })
      .expect(201);
  });

  it('toggle interface meneruskan nama interface dan status disabled', async () => {
    calls.length = 0;
    await api()
      .patch('/api/mikrotik/interfaces/ether1')
      .set(auth(adminToken))
      .send({ disabled: 'true' })
      .expect(200);

    const call = calls.find((entry) => entry.method === 'setInterfaceDisabled');
    expect(call?.args[0]).toBe('ether1');
    expect((call?.args[1] as { disabled: boolean }).disabled).toBe(true);
  });
  it('daftar perangkat bisa dibaca operator dan tidak memuat password', async () => {
    const response = await api()
      .get('/api/mikrotik/devices')
      .set(auth(operatorToken))
      .expect(200);

    expect(response.body.ready).toBe(true);
    expect(response.body.migration).toBe('005_mikrotik_devices.sql');
    expect(response.body.rows[0].name).toBe('Nanggela');
    expect(response.body.rows[0].password_set).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('api_password');
  });

  it('CRUD perangkat hanya untuk admin', async () => {
    const payload = {
      name: 'Router Cabang',
      host: '10.10.10.1',
      api_port: 1998,
      api_user: 'admin',
      api_password: 'rahasia-sekali',
    };

    await api().post('/api/mikrotik/devices').set(auth(operatorToken)).send(payload).expect(403);
    await api().post('/api/mikrotik/devices').set(auth(resellerToken)).send(payload).expect(403);
    await api()
      .patch('/api/mikrotik/devices/1')
      .set(auth(resellerToken))
      .send({ host: '10.0.0.1' })
      .expect(403);
    await api().delete('/api/mikrotik/devices/1').set(auth(operatorToken)).expect(403);

    const created = await api()
      .post('/api/mikrotik/devices')
      .set(auth(adminToken))
      .send(payload)
      .expect(201);

    expect(created.body.name).toBe('Router Cabang');
    // Password dikirim ke server tetapi tidak boleh dipantulkan kembali.
    expect(JSON.stringify(created.body)).not.toContain('rahasia-sekali');
    expect(JSON.stringify(created.body)).not.toContain('api_password');
  });

  it('validasi perangkat menolak host berskema, port di luar rentang, dan nama terlalu pendek', async () => {
    const base = { name: 'Router Uji', host: '10.0.0.1', api_user: 'admin' };

    await api()
      .post('/api/mikrotik/devices')
      .set(auth(adminToken))
      .send({ ...base, host: 'http://10.0.0.1' })
      .expect(400);

    await api()
      .post('/api/mikrotik/devices')
      .set(auth(adminToken))
      .send({ ...base, api_port: 70000 })
      .expect(400);

    await api()
      .post('/api/mikrotik/devices')
      .set(auth(adminToken))
      .send({ ...base, name: 'ab' })
      .expect(400);

    await api()
      .post('/api/mikrotik/devices')
      .set(auth(adminToken))
      .send({ ...base, api_user: 'admin user' })
      .expect(400);
  });

  it('uji koneksi perangkat boleh dijalankan operator', async () => {
    const response = await api()
      .post('/api/mikrotik/devices/1/test')
      .set(auth(operatorToken))
      .expect(200);

    expect(response.body.connected).toBe(true);
    expect(response.body.identity).toBe('BIBIT::NANGGELA');
  });

  it('parameter ?device diteruskan ke service untuk semua endpoint data', async () => {
    calls.length = 0;
    await api().get('/api/mikrotik/status?device=7').set(auth(adminToken)).expect(200);
    await api().get('/api/mikrotik/interfaces?device=7').set(auth(adminToken)).expect(200);

    const forwarded = calls.filter((entry) => entry.method === 'runWithDevice');
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0].args[0]).toBe(7);
    expect(forwarded[1].args[0]).toBe(7);
  });

});

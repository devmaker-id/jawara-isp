import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

// CoA menyentuh jaringan sungguhan; di e2e ini perilakunya disimulasikan.
// vi.mock di-hoist, jadi factory tidak boleh menyentuh variabel top-level.
vi.mock('./../src/app/modules/freeradius/coa-probe.js', () => ({
  probeCoa: async () => ({
    status: 'nak' as const,
    reachable: true,
    detail: 'Disconnect-NAK (uji)',
    elapsed_ms: 1,
  }),
}));

import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { RadiusConfigService } from './../src/app/modules/freeradius/radius-config.service.js';
import { RadiusRepository, RADIUS_TABLES } from './../src/app/modules/freeradius/radius.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';

// Endpoint FreeRADIUS diuji dengan RadiusRepository in-memory: tidak ada
// penulisan ke database, dan status "belum siap" bisa disimulasikan.
describe('FreeRADIUS (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let adminToken: string;
  let operatorToken: string;
  let resellerToken: string;

  const state = {
    tables: [] as string[],
    nas: [{ id: 1, nasname: '192.168.100.254', shortname: 'core', type: 'mikrotik', ports: 1812, server: '', description: 'MikroTik core' }],
    users: [{ id: 1, username: 'budi', password: 'rahasia', groupname: 'vip' }],
  };

  const fakeRadius = {
    existingTables: async () => state.tables,
    counts: async () => ({ nas: state.nas.length, users: state.users.length, sessions: 0, groups: 1 }),
    lastAccountingAt: async () => null,
    listNas: async () => ({ rows: state.nas, total: state.nas.length }),
    findNas: async (id: number) => state.nas.find((row) => row.id === id) ?? null,
    createNas: async (input: { nasname: string }) => {
      const id = state.nas.length + 10;
      state.nas.push({
        id,
        nasname: input.nasname,
        shortname: null,
        type: 'other',
        ports: 1812,
        server: '',
        description: 'baru',
      });
      return id;
    },
    updateNas: async () => undefined,
    deleteNas: async () => 1,
    countNasUsingAddress: async (nasname: string) =>
      state.nas.filter((row) => row.nasname === nasname).length,
    listNasAddresses: async () => state.nas.map((row) => row.nasname),
    listUsers: async () => ({ rows: state.users, total: state.users.length }),
    findUser: async (username: string) => state.users.find((row) => row.username === username) ?? null,
    createUser: async (input: { username: string; password: string; group?: string }) => {
      state.users.push({ id: state.users.length + 1, username: input.username, password: input.password, groupname: input.group ?? null });
    },
    updateUser: async () => undefined,
    deleteUser: async () => undefined,
    sessions: async () => [],
    accounting: async () => [],
  };

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(RadiusRepository)
      .useValue(fakeRadius)
      // Restart FreeRADIUS nyata tidak boleh terjadi saat test.
      .overrideProvider(RadiusConfigService)
      .useValue({ control: async () => ({ service: 'active' }) })
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

  it('tanpa token → 401 dan reseller → 403', async () => {
    await api().get('/api/freeradius/status').expect(401);
    await api().get('/api/freeradius/status').set(auth(resellerToken)).expect(403);
    await api().get('/api/freeradius/nas').set(auth(resellerToken)).expect(403);
  });

  it('status jujur saat tabel rad* belum ada', async () => {
    state.tables = [];
    const response = await api().get('/api/freeradius/status').set(auth(operatorToken)).expect(200);

    expect(response.body.ready).toBe(false);
    expect(response.body.installed).toBe(false);
    expect(response.body.tables_missing).toEqual([...RADIUS_TABLES]);
    expect(String(response.body.message)).toMatch(/004_freeradius_schema\.sql/);
  });

  it('endpoint data memberi 503 (bukan angka nol palsu) saat skema belum ada', async () => {
    state.tables = [];
    for (const path of ['/api/freeradius/nas', '/api/freeradius/sessions']) {
      const response = await api().get(path).set(auth(adminToken)).expect(503);
      expect(String(response.body.message)).toMatch(/radcheck|radacct|nas/);
    }
  });

  it('setelah skema lengkap: daftar NAS/user/sesi → 200 dan secret tidak ikut terkirim', async () => {
    state.tables = [...RADIUS_TABLES];

    const status = await api().get('/api/freeradius/status').set(auth(operatorToken)).expect(200);
    expect(status.body.ready).toBe(true);
    expect(status.body.nas).toBe(state.nas.length);

    const nas = await api().get('/api/freeradius/nas').set(auth(operatorToken)).expect(200);
    expect(nas.body.rows[0].nasname).toBe('192.168.100.254');
    expect(nas.body.rows[0]).not.toHaveProperty('secret');

    // /api/freeradius/users sudah dihapus: akun hanya dikelola lewat Layanan → Voucher.
    await api().get('/api/freeradius/users').set(auth(operatorToken)).expect(404);

    await api().get('/api/freeradius/sessions').set(auth(operatorToken)).expect(200);
    await api().get('/api/freeradius/accounting').set(auth(operatorToken)).expect(200);
  });

  it('operator tidak boleh mengubah NAS/user, admin boleh', async () => {
    state.tables = [...RADIUS_TABLES];

    await api()
      .post('/api/freeradius/nas')
      .set(auth(operatorToken))
      .send({ nasname: '10.0.0.9', secret: 'rahasia123' })
      .expect(403);

    const created = await api()
      .post('/api/freeradius/nas')
      .set(auth(adminToken))
      .send({ nasname: '10.0.0.9', secret: 'rahasia123' })
      .expect(201);
    expect(created.body.id).toBeGreaterThan(0);
    expect(created.body).not.toHaveProperty('secret');
  });

  it('validasi: secret NAS minimal 8 karakter dan alamat wajib', async () => {
    state.tables = [...RADIUS_TABLES];

    await api()
      .post('/api/freeradius/nas')
      .set(auth(adminToken))
      .send({ nasname: '10.0.0.10', secret: 'pendek' })
      .expect(400);

    await api()
      .post('/api/freeradius/nas')
      .set(auth(adminToken))
      .send({ secret: 'rahasia123' })
      .expect(400);
  });

  it('NAS duplikat → 409 dengan pesan yang jelas', async () => {
    state.tables = [...RADIUS_TABLES];

    const response = await api()
      .post('/api/freeradius/nas')
      .set(auth(adminToken))
      .send({ nasname: '192.168.100.254', secret: 'rahasia123' })
      .expect(409);

    expect(String(response.body.message)).toMatch(/sudah terdaftar/);
  });

  it('akun RADIUS tidak bisa dibuat dari modul FreeRADIUS (satu pintu di Layanan)', async () => {
    state.tables = [...RADIUS_TABLES];

    // Rute lama harus hilang: kalau masih ada, dua jalur bisa menulis radcheck
    // dan grup teks bebas bisa menggantung tanpa atribut.
    await api()
      .post('/api/freeradius/users')
      .set(auth(adminToken))
      .send({ username: 'siti', password: 'rahasia', group: 'vip' })
      .expect(404);
  });
});
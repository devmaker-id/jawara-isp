import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from './../src/app/config/config.service.js';
import { UsersRepository } from './../src/app/modules/users/users.repository.js';
import { SettingsRepository } from './../src/app/modules/settings/settings.repository.js';
import { createFakeUsers, FakeUsers } from './helpers/fake-users.js';

// Pengaturan diuji lewat HTTP dengan repository in-memory: tabel config
// produksi tidak disentuh.
describe('Settings (e2e)', () => {
  let app: INestApplication<App>;
  let fakeUsers: FakeUsers;
  let adminToken: string;
  let operatorToken: string;
  const store: Record<string, string> = {};

  beforeAll(async () => {
    fakeUsers = await createFakeUsers();
    const fakeSettings = {
      findValues: async () => ({ ...store }),
      upsert: async (values: Record<string, string>) => {
        Object.assign(store, values);
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UsersRepository)
      .useValue(fakeUsers.repo)
      .overrideProvider(SettingsRepository)
      .useValue(fakeSettings)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const secret = app.get(ConfigService).jwtSecret;
    const sign = (sub: number, role: string, email: string) =>
      new JwtService().sign({ sub, email, role }, { secret, expiresIn: '1h' });
    adminToken = sign(1, 'admin', 'admin@uji.test');
    operatorToken = sign(2, 'operator', 'operator@uji.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('tanpa token → 401', async () => {
    await api().get('/api/settings').expect(401);
  });

  it('operator boleh membaca (nilai default + grup)', async () => {
    const res = await api().get('/api/settings').set(auth(operatorToken)).expect(200);
    expect(res.body.values.brand_name).toBe('BibitNet');
    expect(res.body.groups.payment).toContain('payment_mode');
  });

  it('operator tidak boleh mengubah → 403', async () => {
    await api()
      .put('/api/settings')
      .set(auth(operatorToken))
      .send({ values: { brand_name: 'X' } })
      .expect(403);
  });

  it('admin menyimpan branding + payment gateway', async () => {
    const res = await api()
      .put('/api/settings')
      .set(auth(adminToken))
      .send({
        values: {
          brand_name: 'BibitNet Nanggela',
          payment_mode: 'gateway',
          payment_gateway_provider: 'midtrans',
          payment_gateway_server_key: 'server-key-rahasia',
        },
      })
      .expect(200);

    expect(res.body.values.brand_name).toBe('BibitNet Nanggela');
    expect(res.body.values.payment_mode).toBe('gateway');
    expect(res.body.values.payment_gateway_server_key).toBe('********');
    expect(res.body.secrets_set.payment_gateway_server_key).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('server-key-rahasia');
  });

  it('mengirim ulang placeholder tidak menghapus token tersimpan', async () => {
    await api()
      .put('/api/settings')
      .set(auth(adminToken))
      .send({ values: { payment_gateway_server_key: '********', brand_tagline: 'Stabil' } })
      .expect(200);

    expect(store.payment_gateway_server_key).toBe('server-key-rahasia');
  });

  it('kunci tidak dikenal → 400', async () => {
    await api()
      .put('/api/settings')
      .set(auth(adminToken))
      .send({ values: { db_root_password: 'bocor' } })
      .expect(400);
  });

  // Kredensial perangkat kini boleh diisi dari Pengaturan → Integrasi,
  // tetapi respons tidak boleh memuat nilainya.
  it('password MikroTik tersimpan tanpa pernah dikembalikan', async () => {
    await api()
      .put('/api/settings')
      .set(auth(adminToken))
      .send({ values: { mikrotik_password: 'rahasia-router' } })
      .expect(200);

    const response = await api().get('/api/settings').set(auth(adminToken)).expect(200);
    expect(response.body.values.mikrotik_password).toBe('********');
    expect(response.body.secrets_set.mikrotik_password).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('rahasia-router');
  });

  it('nilai bukan teks → 400', async () => {
    await api()
      .put('/api/settings')
      .set(auth(adminToken))
      .send({ values: { brand_name: 42 } })
      .expect(400);
  });
});

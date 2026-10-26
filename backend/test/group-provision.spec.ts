import { describe, expect, it, vi } from 'vitest';

// Atribut profil lokal yang dibuat dari Group Profile. Dua jebakan nyata:
//  1. `dns-server` tidak ada di /ip/hotspot/user/profile — RouterOS menolak
//     SELURUH perintah, bukan hanya atribut itu.
//  2. parent queue DEFAULT harus ditulis `none`; kalau dilewati, queue lama
//     tetap menempel karena `set` tidak menyentuh field yang tidak dikirim.
const calls: Array<Record<string, string>> = [];
const sent: string[][] = [];

vi.mock('../src/app/modules/mikrotik/routeros.client', () => ({
  RouterOsClient: class {
    async execute(words: string[][]) {
      sent.push(words[0]);
      const command = words[0][0];
      if (command.endsWith('/print')) return { records: [] as Record<string, string>[] };
      const attrs: Record<string, string> = {};
      for (const word of words[0].slice(1)) {
        const match = /^=([^=]+)=(.*)$/.exec(word);
        if (match) attrs[match[1]] = match[2];
      }
      calls.push(attrs);
      return { records: [] as Record<string, string>[] };
    }
  },
  RouterOsError: class extends Error {},
}));

import { MikrotikService } from '../src/app/modules/mikrotik/mikrotik.service';

const device = (over: Record<string, unknown> = {}) => ({
  id: 3,
  name: 'Jmnt Gajrug',
  host: '10.200.10.242',
  api_port: 8728,
  api_user: 'user1',
  api_password: 'x',
  write_enabled: 1,
  is_active: 1,
  gui_url: '',
  ...over,
});

const makeService = (over: Record<string, unknown> = {}) =>
  new MikrotikService(
    { secretKey: 'k' } as never,
    {} as never,
    { find: async () => device(over) } as never,
  );

describe('provisionGroupProfile', () => {
  it('profil PPP mendapat parent-queue, pool, dan dns-server', async () => {
    calls.length = 0;
    const service = makeService();
    const result = await service.provisionGroupProfile({
      deviceId: 3,
      type: 'ppp',
      name: 'WARUNG',
      parentQueue: 'A.CLIENT-PPP',
      poolName: 'PPP-POOL',
      dnsPrimary: '8.8.8.8',
      dnsSecondary: '1.1.1.1',
    });

    expect(result.action).toBe('created');
    expect(calls[0]).toMatchObject({
      name: 'WARUNG',
      'parent-queue': 'A.CLIENT-PPP',
      'remote-address': 'PPP-POOL',
      'dns-server': '8.8.8.8,1.1.1.1',
    });
  });

  it('profil hotspot TIDAK mengirim dns-server (properti tidak ada di RouterOS)', async () => {
    calls.length = 0;
    const service = makeService();
    await service.provisionGroupProfile({
      deviceId: 3,
      type: 'hotspot',
      name: 'hs-gajrug',
      parentQueue: 'B.HOTSPOT',
      poolName: 'HS-HOTSPOT',
      dnsPrimary: '8.8.8.8',
      dnsSecondary: '1.1.1.1',
    });

    expect(calls[0]).not.toHaveProperty('dns-server');
    expect(calls[0]).toMatchObject({
      name: 'hs-gajrug',
      'parent-queue': 'B.HOTSPOT',
      'address-pool': 'HS-HOTSPOT',
    });
  });

  it('parent queue DEFAULT ditulis none, bukan dilewati', async () => {
    calls.length = 0;
    const service = makeService();
    await service.provisionGroupProfile({
      deviceId: 3,
      type: 'ppp',
      name: 'TANPA-QUEUE',
      parentQueue: 'DEFAULT',
      poolName: null,
      dnsPrimary: null,
      dnsSecondary: null,
    });

    expect(calls[0]['parent-queue']).toBe('none');
  });

  it('tidak menulis rate-limit: nilai itu datang dari RADIUS', async () => {
    calls.length = 0;
    const service = makeService();
    await service.provisionGroupProfile({
      deviceId: 3,
      type: 'ppp',
      name: 'X',
      parentQueue: null,
      poolName: null,
      dnsPrimary: null,
      dnsSecondary: null,
    });

    expect(calls[0]).not.toHaveProperty('rate-limit');
  });

  it('perangkat tanpa izin tulis dilaporkan skipped, bukan dilempar', async () => {
    const service = makeService({
      id: 2,
      name: 'Switch Core Edge',
      host: '192.168.100.10',
      write_enabled: 0,
    });

    const result = await service.provisionGroupProfile({
      deviceId: 2,
      type: 'ppp',
      name: 'Y',
      parentQueue: null,
      poolName: null,
      dnsPrimary: null,
      dnsSecondary: null,
    });

    expect(result.ok).toBe(false);
    expect(result.action).toBe('skipped');
    // Perintah manual harus memakai bentuk yang benar: <path>/add
    expect(result.command.startsWith('/ppp/profile/add ')).toBe(true);
  });
});

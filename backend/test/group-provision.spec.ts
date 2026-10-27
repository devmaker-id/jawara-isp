import { describe, expect, it, vi } from 'vitest';

// Atribut profil lokal yang dibuat dari Group Profile. Dua jebakan nyata:
//  1. `dns-server` tidak ada di /ip/hotspot/user/profile — RouterOS menolak
//     SELURUH perintah, bukan hanya atribut itu.
//  2. parent queue DEFAULT harus ditulis `none`; kalau dilewati, queue lama
//     tetap menempel karena `set` tidak menyentuh field yang tidak dikirim.
const calls: Array<Record<string, string>> = [];
const sent: string[][] = [];
/** Perintah yang menyentuh /ip/pool (dibuat/diubah panel). */
const poolCalls: Array<{ command: string; attrs: Record<string, string> }> = [];

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
      if (command.startsWith('/ip/pool/')) {
        poolCalls.push({ command, attrs });
        return { records: [] as Record<string, string>[] };
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

describe('router-pool: pool dibuat panel di router', () => {
  const comment = 'created by jawara-isp';

  it('PPP membuat /ip/pool lalu profil dengan local-address dan remote-address', async () => {
    calls.length = 0;
    poolCalls.length = 0;
    const service = makeService();
    const result = await service.provisionGroupProfile({
      deviceId: 3,
      type: 'ppp',
      name: 'RUMAHAN',
      parentQueue: 'A.CLIENT-PPP',
      poolName: 'jw-RUMAHAN',
      createPool: { name: 'jw-RUMAHAN', rangeStart: '172.10.0.2', rangeEnd: '172.10.0.254' },
      localAddress: '172.10.0.1',
      dnsPrimary: '8.8.8.8',
      dnsSecondary: '1.1.1.1',
    });

    expect(result.ok).toBe(true);
    expect(poolCalls[0].command).toBe('/ip/pool/add');
    expect(poolCalls[0].attrs).toEqual({
      name: 'jw-RUMAHAN',
      ranges: '172.10.0.2-172.10.0.254',
      comment,
    });
    // Gateway TIDAK ikut ke dalam ranges.
    expect(poolCalls[0].attrs.ranges).not.toContain('172.10.0.1-');
    expect(calls[0]).toMatchObject({
      name: 'RUMAHAN',
      'local-address': '172.10.0.1',
      'remote-address': 'jw-RUMAHAN',
      'dns-server': '8.8.8.8,1.1.1.1',
      'parent-queue': 'A.CLIENT-PPP',
      comment,
    });
  });

  it('hotspot memakai address-pool, tanpa comment (ditolak RouterOS 6.49)', async () => {
    calls.length = 0;
    poolCalls.length = 0;
    const service = makeService();
    await service.provisionGroupProfile({
      deviceId: 3,
      type: 'hotspot',
      name: 'hs-warkop',
      parentQueue: 'B.HOTSPOT',
      poolName: 'jw-hs-warkop',
      createPool: { name: 'jw-hs-warkop', rangeStart: '10.10.0.2', rangeEnd: '10.10.0.254' },
      dnsPrimary: '8.8.8.8',
      dnsSecondary: '1.1.1.1',
    });

    expect(poolCalls[0].attrs).toEqual({
      name: 'jw-hs-warkop',
      ranges: '10.10.0.2-10.10.0.254',
      comment,
    });
    // comment pada /ip/hotspot/user/profile membuat RouterOS menolak perintah.
    expect(calls[0]).not.toHaveProperty('comment');
    expect(calls[0]).not.toHaveProperty('dns-server');
    expect(calls[0]).toMatchObject({ 'address-pool': 'jw-hs-warkop' });
  });

  it('perintah manual menulis pool lebih dulu, lalu profil', async () => {
    const service = makeService({ write_enabled: 0 });
    const result = await service.provisionGroupProfile({
      deviceId: 3,
      type: 'ppp',
      name: 'X',
      poolName: 'jw-X',
      createPool: { name: 'jw-X', rangeStart: '172.10.0.2', rangeEnd: '172.10.0.254' },
      localAddress: '172.10.0.1',
    });

    expect(result.action).toBe('skipped');
    const [poolPart, profilePart] = result.command.split(' ; ');
    expect(poolPart.startsWith('/ip/pool/add ')).toBe(true);
    expect(profilePart.startsWith('/ppp/profile/add ')).toBe(true);
  });
});

import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RouterOsClient,
  RouterOsError,
  SentenceDecoder,
  encodeLength,
  encodeSentence,
} from '../src/app/modules/mikrotik/routeros.client';

// Tes protokol API RouterOS. Tidak ada perangkat nyata di sini: server TCP
// palsu memakai SentenceDecoder yang sama, sehingga encoding/decoding diuji
// dari dua arah.
describe('RouterOS API — encoding', () => {
  it('panjang < 0x80 memakai satu byte', () => {
    expect([...encodeLength(0)]).toEqual([0x00]);
    expect([...encodeLength(5)]).toEqual([0x05]);
    expect([...encodeLength(0x7f)]).toEqual([0x7f]);
  });

  it('panjang 0x80..0x3fff memakai dua byte', () => {
    expect([...encodeLength(0x80)]).toEqual([0x80, 0x80]);
    expect([...encodeLength(0x1234)]).toEqual([0x92, 0x34]);
  });

  it('panjang besar memakai 3, 4, dan 5 byte', () => {
    expect([...encodeLength(0x2000)]).toEqual([0xa0, 0x00]);
    expect([...encodeLength(0x10000)]).toEqual([0xc1, 0x00, 0x00]);
    // 0x200000 → 4 byte dengan prefix 0xe0 (tanpa RangeError)
    const four = encodeLength(0x200000);
    expect(four.length).toBe(4);
    expect(four[0] & 0xf0).toBe(0xe0);
    expect(four.readUInt32BE(0) & 0x0fffffff).toBe(0x200000);
    // Di atas 0x0FFFFFFF ditolak: RouterOS tidak punya header 5 byte.
    expect(() => encodeLength(0x10000000)).toThrow(/melebihi batas RouterOS/);
  });

  it('menolak panjang negatif dan bukan bilangan bulat', () => {
    expect(() => encodeLength(-1)).toThrow(RouterOsError);
    expect(() => encodeLength(1.5)).toThrow(RouterOsError);
  });

  it('sentence diakhiri kata kosong', () => {
    const encoded = encodeSentence(['/login', '=name=hermes']);
    expect(encoded[encoded.length - 1]).toBe(0x00);
    expect(encoded.subarray(1, 7).toString('utf8')).toBe('/login');
  });
});

describe('RouterOS API — decoding', () => {
  const sentence = (...words: string[]) => encodeSentence(words);

  it('mengurai beberapa sentence dalam satu potongan', () => {
    const decoder = new SentenceDecoder();
    const chunk = Buffer.concat([sentence('!re', '=name=BIBIT'), sentence('!done')]);
    expect(decoder.push(chunk)).toEqual([
      ['!re', '=name=BIBIT'],
      ['!done'],
    ]);
  });

  it('menahan potongan yang memenggal kata', () => {
    const decoder = new SentenceDecoder();
    const chunk = sentence('!re', '=uptime=1w2d');
    const firstHalf = decoder.push(chunk.subarray(0, 5));
    expect(firstHalf).toEqual([]);
    const rest = decoder.push(chunk.subarray(5));
    expect(rest).toEqual([['!re', '=uptime=1w2d']]);
  });

  it('mengurai per byte tanpa kehilangan data', () => {
    const decoder = new SentenceDecoder();
    const chunk = sentence('!re', '=name=x', '=type=ether');
    const collected: string[][] = [];
    for (const byte of chunk) {
      collected.push(...decoder.push(Buffer.from([byte])));
    }
    expect(collected).toEqual([['!re', '=name=x', '=type=ether']]);
  });
});

// ===== klien terhadap server TCP palsu =====
interface FakeRouterOptions {
  password: string;
  identity: string;
  rejectCommands?: string[];
}

class FakeRouter {
  private server: net.Server;
  port = 0;
  received: string[][] = [];
  private sockets: net.Socket[] = [];

  constructor(private readonly options: FakeRouterOptions) {
    this.server = net.createServer((socket) => {
      this.sockets.push(socket);
      const decoder = new SentenceDecoder();
      socket.on('data', (chunk) => {
        for (const sentence of decoder.push(chunk)) {
          this.received.push(sentence);
          this.handle(socket, sentence);
        }
      });
    });
  }

  private handle(socket: net.Socket, sentence: string[]) {
    const command = sentence[0];
    if (command === '/login') {
      const password = sentence.find((word) => word.startsWith('=password='))?.slice('=password='.length);
      if (password !== this.options.password) {
        socket.write(
          Buffer.concat([
            encodeSentence(['!trap', '=message=invalid user name or password (6)']),
            encodeSentence(['!done']),
          ]),
        );
        return;
      }
      socket.write(encodeSentence(['!done']));
      return;
    }

    if (this.options.rejectCommands?.includes(command)) {
      socket.write(
        Buffer.concat([
          encodeSentence(['!trap', '=message=no such command']),
          encodeSentence(['!done']),
        ]),
      );
      return;
    }

    if (command === '/system/identity/print') {
      socket.write(
        Buffer.concat([
          encodeSentence(['!re', `.id=*1`, `=name=${this.options.identity}`, '=disabled=false']),
          encodeSentence(['!done']),
        ]),
      );
      return;
    }

    if (command === '/interface/print') {
      socket.write(
        Buffer.concat([
          encodeSentence(['!re', '=name=ether1', '=type=ether', '=mtu=1500', '=running=true']),
          encodeSentence(['!re', '=name=vlan302', '=type=vlan', '=mtu=1500', '=running=false', '=disabled=true']),
          encodeSentence(['!done']),
        ]),
      );
      return;
    }

    socket.write(encodeSentence(['!done']));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe('RouterOS API — klien', () => {
  let router: FakeRouter | null = null;

  afterEach(async () => {
    if (router) await router.stop();
    router = null;
  });

  it('login lalu membaca record per perintah', async () => {
    router = new FakeRouter({ password: 'rahasia', identity: 'BIBIT::UJI' });
    const port = await router.start();
    const client = new RouterOsClient({
      host: '127.0.0.1',
      port,
      user: 'hermes',
      password: 'rahasia',
      timeoutMs: 2000,
    });

    const results = await client.executeEach([
      ['/system/identity/print'],
      ['/interface/print'],
    ]);

    expect(results[0].records).toEqual([{ '.id': '*1', name: 'BIBIT::UJI', disabled: 'false' }]);
    expect(results[1].records.map((row) => row.name)).toEqual(['ether1', 'vlan302']);
    expect(results[1].records[1].disabled).toBe('true');
  });

  it('password salah menghasilkan error login yang jelas', async () => {
    router = new FakeRouter({ password: 'benar', identity: 'x' });
    const port = await router.start();
    const client = new RouterOsClient({
      host: '127.0.0.1',
      port,
      user: 'hermes',
      password: 'salah',
      timeoutMs: 2000,
    });

    await expect(client.execute([['/system/identity/print']])).rejects.toMatchObject({
      kind: 'login',
    });
    await expect(client.execute([['/system/identity/print']])).rejects.toThrow(/Login API MikroTik ditolak/);
  });

  it('trap pada perintah biasa menjadi error kind trap', async () => {
    router = new FakeRouter({ password: 'rahasia', identity: 'x', rejectCommands: ['/ip/route/print'] });
    const port = await router.start();
    const client = new RouterOsClient({
      host: '127.0.0.1',
      port,
      user: 'hermes',
      password: 'rahasia',
      timeoutMs: 2000,
    });

    await expect(client.execute([['/ip/route/print']])).rejects.toMatchObject({ kind: 'trap' });
  });

  it('port tertutup menghasilkan error connection', async () => {
    const client = new RouterOsClient({
      host: '127.0.0.1',
      port: 1,
      user: 'hermes',
      password: 'x',
      timeoutMs: 1000,
    });
    await expect(client.execute([['/system/identity/print']])).rejects.toMatchObject({
      kind: 'connection',
    });
  });
});
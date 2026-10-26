import { createHash, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';

// Uji CoA (RFC 5176) dari server ke NAS tanpa pustaka tambahan.
// Disconnect-Request dikirim ke <nas>:3799; balasan Disconnect-NAK tetap
// dianggap BERHASIL karena artinya paket sampai dan secret cocok — NAS hanya
// tidak menemukan sesi untuk user itu.

const CODE_DISCONNECT_REQUEST = 40;
const CODE_DISCONNECT_ACK = 41;
const CODE_DISCONNECT_NAK = 42;
const ATTR_USER_NAME = 1;

export type CoaProbeStatus = 'ack' | 'nak' | 'timeout' | 'error';

export interface CoaProbeResult {
  status: CoaProbeStatus;
  /** true bila paket sampai dan secret diterima (ack maupun nak). */
  reachable: boolean;
  detail: string;
  elapsed_ms: number;
}

function attribute(type: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type, value.length + 2]), value]);
}

/** Paket RADIUS: code, id, length, authenticator, attributes. */
export function buildDisconnectRequest(identifier: number, username: string, secret: string): Buffer {
  const attrs = attribute(ATTR_USER_NAME, Buffer.from(username, 'utf8'));
  const length = 20 + attrs.length;
  const header = Buffer.alloc(4);
  header[0] = CODE_DISCONNECT_REQUEST;
  header[1] = identifier;
  header.writeUInt16BE(length, 2);
  // Authenticator = MD5(code + id + length + 16 nol + attributes + secret)
  const digest = createHash('md5')
    .update(Buffer.concat([header, Buffer.alloc(16), attrs, Buffer.from(secret, 'utf8')]))
    .digest();
  return Buffer.concat([header, digest, attrs]);
}

export function classifyReply(code: number): CoaProbeStatus {
  if (code === CODE_DISCONNECT_ACK) return 'ack';
  if (code === CODE_DISCONNECT_NAK) return 'nak';
  return 'error';
}

export async function probeCoa(options: {
  host: string;
  port?: number;
  secret: string;
  username?: string;
  timeoutMs?: number;
  // RouterOS hanya menjawab CoA/Disconnect dari alamat server RADIUS yang
  // terdaftar di perangkat; paket dari alamat lain dibuang tanpa balasan.
  sourceAddress?: string;
}): Promise<CoaProbeResult> {
  const port = options.port ?? 3799;
  const timeoutMs = options.timeoutMs ?? 3000;
  const username = options.username ?? `coa-probe-${randomBytes(4).toString('hex')}`;
  const identifier = randomBytes(1)[0];
  const started = Date.now();

  const socket = createSocket('udp4');
  const packet = buildDisconnectRequest(identifier, username, options.secret);

  return new Promise<CoaProbeResult>((resolve) => {
    let settled = false;
    const finish = (result: CoaProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* sudah tertutup */
      }
      resolve({ ...result, elapsed_ms: Date.now() - started });
    };

    const timer = setTimeout(
      () =>
        finish({
          status: 'timeout',
          reachable: false,
          detail: `Tidak ada balasan dari ${options.host}:${port} dalam ${timeoutMs} ms.`,
          elapsed_ms: 0,
        }),
      timeoutMs,
    );

    socket.on('error', (error) =>
      finish({ status: 'error', reachable: false, detail: error.message, elapsed_ms: 0 }),
    );

    socket.on('message', (message) => {
      if (message.length < 20 || message[1] !== identifier) return;
      const status = classifyReply(message[0]);
      if (status === 'ack') {
        finish({ status, reachable: true, detail: 'Disconnect-ACK diterima: NAS menerima CoA dan secret cocok.', elapsed_ms: 0 });
      } else if (status === 'nak') {
        finish({
          status,
          reachable: true,
          detail: 'Disconnect-NAK diterima: NAS menerima CoA dan secret cocok (tidak ada sesi untuk user uji).',
          elapsed_ms: 0,
        });
      } else {
        finish({
          status,
          reachable: false,
          detail: `Balasan dengan kode ${message[0]} bukan ACK/NAK — periksa secret NAS.`,
          elapsed_ms: 0,
        });
      }
    });

    const send = () =>
      socket.send(packet, port, options.host, (error) => {
        if (error) finish({ status: 'error', reachable: false, detail: error.message, elapsed_ms: 0 });
      });

    if (options.sourceAddress) {
      socket.bind(0, options.sourceAddress, send);
    } else {
      socket.bind(0, send);
    }
  });
}

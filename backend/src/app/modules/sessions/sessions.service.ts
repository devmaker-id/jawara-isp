import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { isIPv4 } from 'node:net';
import { RequestScope, SYSTEM_SCOPE } from '../auth/request-scope';
import { SessionFilter, SessionsRepository } from './sessions.repository';

const DISCONNECT_REQUEST = 40;
const DISCONNECT_ACK = 41;
const DISCONNECT_NAK = 42;
const TIMEOUT_MS = 3000;
const RETRIES = 2;

export interface DisconnectResult {
  ok: boolean;
  outcome: 'ack' | 'nak' | 'no-reply';
  message: string;
  nas: string;
  nas_name: string | null;
  port: number;
  /** Alamat sumber yang dipakai; null = dipilih kernel. */
  source: string | null;
}

export interface CoaTarget {
  nasIp: string;
  port: number;
  secret: string;
  username: string;
  sessionId: string;
  /**
   * IP pelanggan (Framed-IP-Address). RouterOS mencocokkan Disconnect-Request
   * sesi hotspot lewat atribut ini: tanpa Framed-IP jawabannya selalu
   * Disconnect-NAK walau User-Name dan Acct-Session-Id benar.
   */
  framedIp?: string | null;
  /**
   * Alamat lokal sumber paket. RouterOS hanya memproses CoA/Disconnect yang
   * datang dari IP server RADIUS yang terdaftar di perangkat; tanpa ini paket
   * keluar dari IP rute (mis. 10.200.10.10) dan dibuang tanpa balasan.
   */
  source?: string | null;
}

const attribute = (type: number, value: Buffer): Buffer =>
  Buffer.concat([Buffer.from([type, value.length + 2]), value]);

const ipv4 = (address: string): Buffer =>
  Buffer.from(address.split('.').map((part) => Number(part) & 0xff));

/**
 * Disconnect-Request (RFC 5176) lengkap dengan Message-Authenticator (RFC 3579).
 * Paket dibangun sendiri karena `radclient` tidak bisa memaksa alamat sumber.
 */
export function buildDisconnectPacket(target: CoaTarget, identifier?: number): Buffer {
  const secret = Buffer.from(target.secret, 'utf8');
  const id = identifier ?? randomBytes(1)[0];
  const attributes = Buffer.concat([
    attribute(1, Buffer.from(target.username, 'utf8')),
    attribute(44, Buffer.from(target.sessionId, 'utf8')),
    attribute(4, ipv4(target.nasIp)),
    // Framed-IP wajib untuk sesi hotspot: tanpanya RouterOS menjawab NAK.
    ...(target.framedIp && isIPv4(target.framedIp)
      ? [attribute(8, ipv4(target.framedIp))]
      : []),
  ]);

  const header = (authenticator: Buffer, body: Buffer): Buffer => {
    const buffer = Buffer.alloc(20 + body.length);
    buffer[0] = DISCONNECT_REQUEST;
    buffer[1] = id;
    buffer.writeUInt16BE(buffer.length, 2);
    authenticator.copy(buffer, 4);
    body.copy(buffer, 20);
    return buffer;
  };

  // MA = HMAC-MD5(paket dengan MA = 0 dan Request Authenticator = 0)
  const placeholder = header(
    Buffer.alloc(16),
    Buffer.concat([attributes, attribute(80, Buffer.alloc(16))]),
  );
  const messageAuthenticator = createHmac('md5', secret).update(placeholder).digest();
  const body = Buffer.concat([attributes, attribute(80, messageAuthenticator)]);

  // Request Authenticator = MD5(Code+ID+Length+0*16+Attributes+Secret)
  const requestAuthenticator = createHash('md5')
    .update(header(Buffer.alloc(16), body))
    .update(secret)
    .digest();

  return header(requestAuthenticator, body);
}

function attempt(target: CoaTarget, packet: Buffer): Promise<'ack' | 'nak' | null> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let settled = false;
    const finish = (outcome: 'ack' | 'nak' | null) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.close();
      resolve(outcome);
    };

    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(error);
    });
    socket.on('message', (message) => {
      if (message.length < 20) return;
      if (message[0] === DISCONNECT_ACK) finish('ack');
      else if (message[0] === DISCONNECT_NAK) finish('nak');
    });

    socket.bind({ address: target.source ?? '0.0.0.0', port: 0 }, () => {
      socket.send(packet, target.port, target.nasIp);
      setTimeout(() => finish(null), TIMEOUT_MS);
    });
  });
}

/** Kirim Disconnect-Request; `no-reply` berarti NAS tidak menjawab sama sekali. */
export async function sendDisconnectRequest(
  target: CoaTarget,
): Promise<'ack' | 'nak' | 'no-reply'> {
  const packet = buildDisconnectPacket(target);
  for (let index = 0; index <= RETRIES; index += 1) {
    const outcome = await attempt(target, packet);
    if (outcome) return outcome;
  }
  return 'no-reply';
}

/**
 * Memutus sesi lewat RADIUS: Disconnect-Request (RFC 5176) ke NAS pada port CoA,
 * dengan secret yang sama seperti FreeRADIUS dan alamat sumber yang dikenal NAS.
 *
 * Tidak ada tulisan ke database: sesi baru berhenti setelah NAS mengirim
 * Accounting-Stop sendiri. Bila NAS menolak/tidak menjawab, baris `radacct`
 * tetap terbuka dan itu dilaporkan apa adanya — bukan dihapus.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly repository: SessionsRepository) {}

  list(filter: SessionFilter, scope: RequestScope = SYSTEM_SCOPE) {
    return this.repository.list(filter, scope);
  }

  async detail(acctuniqueid: string, scope: RequestScope = SYSTEM_SCOPE) {
    const row = await this.repository.detail(acctuniqueid, scope);
    if (!row) throw new NotFoundException('Sesi tidak ditemukan atau sudah berakhir');
    return row;
  }

  async disconnect(
    acctuniqueid: string,
    scope: RequestScope = SYSTEM_SCOPE,
  ): Promise<DisconnectResult> {
    const target = await this.repository.disconnectTarget(acctuniqueid, scope);
    if (!target) {
      throw new NotFoundException('Sesi tidak ditemukan atau sudah berakhir');
    }
    if (!target.username) {
      throw new ConflictException('Sesi tanpa username tidak bisa diputus lewat RADIUS');
    }

    const secret = await this.repository.nasSecret(target.nasipaddress);
    if (!secret) {
      throw new ConflictException(
        `Secret NAS ${target.nasipaddress} tidak ada di tabel nas; Disconnect tidak bisa dikirim`,
      );
    }
    const port = await this.repository.coaPort();
    const source = await this.repository.coaSource();

    const outcome = await sendDisconnectRequest({
      nasIp: target.nasipaddress,
      port,
      secret,
      username: target.username,
      sessionId: target.acctsessionid,
      framedIp: target.framedipaddress,
      source,
    });

    const base = { nas: target.nasipaddress, nas_name: target.nas_name, port, source };
    if (outcome === 'ack') {
      return { ...base, ok: true, outcome: 'ack', message: 'NAS menerima permintaan putus sesi' };
    }
    if (outcome === 'nak') {
      return {
        ...base,
        ok: false,
        outcome: 'nak',
        message: 'NAS menolak permintaan (sesi mungkin sudah tidak aktif di perangkat)',
      };
    }
    return {
      ...base,
      ok: false,
      outcome: 'no-reply',
      message: source
        ? `NAS tidak menjawab pada port ${port} dari sumber ${source} (CoA belum aktif atau sumber tidak diizinkan NAS)`
        : `NAS tidak menjawab pada port ${port} (CoA belum aktif atau port tertutup)`,
    };
  }
}

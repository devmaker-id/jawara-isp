import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { buildDisconnectPacket, CoaTarget } from '../src/app/modules/sessions/sessions.service';

// Paket RADIUS diuji tanpa jaringan: struktur, Message-Authenticator, dan
// Request Authenticator dihitung ulang dari nol dengan cara yang sama seperti
// yang dilakukan NAS saat memverifikasi.

const target: CoaTarget = {
  nasIp: '10.200.10.242',
  port: 3799,
  secret: 'rahasia-uji',
  username: 'uji-user',
  sessionId: 'sesi-123',
  framedIp: '192.150.0.10',
};

const zero = (packet: Buffer): Buffer => {
  const copy = Buffer.from(packet);
  copy.fill(0, 4, 20);
  return copy;
};

describe('buildDisconnectPacket', () => {
  it('memakai kode Disconnect-Request dengan panjang yang benar', () => {
    const packet = buildDisconnectPacket(target, 7);
    expect(packet[0]).toBe(40);
    expect(packet[1]).toBe(7);
    expect(packet.readUInt16BE(2)).toBe(packet.length);
    expect(packet.length).toBeGreaterThan(20);
  });

  it('memuat User-Name, Acct-Session-Id, NAS-IP-Address, dan Message-Authenticator', () => {
    const packet = buildDisconnectPacket(target, 7);
    const text = packet.toString('latin1');
    expect(text).toContain('uji-user');
    expect(text).toContain('sesi-123');
    // NAS-IP-Address = 10.200.10.242 sebagai 4 byte biner.
    expect(packet.includes(Buffer.from([10, 200, 10, 242]))).toBe(true);
    // Message-Authenticator = type 80, length 18.
    expect(packet.includes(Buffer.from([80, 18]))).toBe(true);
  });

  it('memuat Framed-IP-Address untuk sesi hotspot', () => {
    const packet = buildDisconnectPacket(target, 5);
    // Atribut 8 (Framed-IP-Address) dengan panjang 6.
    const index = packet.indexOf(Buffer.from([8, 6, 192, 150, 0, 10]));
    expect(index).toBeGreaterThan(0);
  });

  it('tidak menambahkan Framed-IP bila sesi tidak punya IP', () => {
    const packet = buildDisconnectPacket({ ...target, framedIp: null }, 5);
    expect(packet.includes(Buffer.from([8, 6]))).toBe(false);
  });

  it('Message-Authenticator cocok bila dihitung ulang dari paket', () => {
    const packet = buildDisconnectPacket(target, 9);
    const index = packet.indexOf(Buffer.from([80, 18]));
    expect(index).toBeGreaterThan(0);
    const embedded = packet.subarray(index + 2, index + 18);

    // MA = HMAC-MD5(paket dengan MA=0 dan Request Authenticator=0)
    const forMa = zero(packet);
    forMa.fill(0, index + 2, index + 18);
    const expected = createHmac('md5', Buffer.from(target.secret)).update(forMa).digest();
    expect(embedded.equals(expected)).toBe(true);
  });

  it('Request Authenticator cocok bila dihitung ulang dari paket', () => {
    const packet = buildDisconnectPacket(target, 11);
    const withoutAuth = zero(packet);
    const expected = createHash('md5')
      .update(withoutAuth)
      .update(Buffer.from(target.secret))
      .digest();
    expect(packet.subarray(4, 20).equals(expected)).toBe(true);
  });
});

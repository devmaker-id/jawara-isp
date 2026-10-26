import { describe, expect, it } from 'vitest';
import { parseClock } from '../src/app/modules/mikrotik/mikrotik.service';

// Jam perangkat menentukan acctstarttime dan masa aktif voucher. Dua format
// tanggal harus terbaca, dan offset harus diambil dari gmt-offset, bukan nama
// zona: satu perangkat ROS 6 di lapangan memakai Australia/Sydney (+11:00).
describe('parseClock', () => {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  it('membaca format ROS 7 (ISO) dengan offset +07:00', () => {
    expect(iso(parseClock('2026-10-25', '23:19:49', '+07:00', 'Asia/Jakarta'))).toBe(
      '2026-10-25T16:19:49.000Z',
    );
  });

  it('membaca format ROS 6 (okt/26/2026)', () => {
    expect(iso(parseClock('oct/26/2026', '04:28:53', '+11:00', 'Australia/Sydney'))).toBe(
      '2026-10-25T17:28:53.000Z',
    );
  });

  it('mengutamakan gmt-offset walau nama zona menyesatkan', () => {
    // Nama zona bilang Jakarta, tapi offset aktif +11:00 (DST/keliru set).
    expect(iso(parseClock('2026-10-25', '12:00:00', '+11:00', 'Asia/Jakarta'))).toBe(
      '2026-10-25T01:00:00.000Z',
    );
  });

  it('jatuh ke +07:00 bila offset tidak dilaporkan tetapi zona WIB', () => {
    expect(iso(parseClock('2026-10-25', '10:00:00', '', 'Asia/Jakarta'))).toBe(
      '2026-10-25T03:00:00.000Z',
    );
  });

  it('mengembalikan null untuk masukan yang tidak terbaca, bukan menebak', () => {
    expect(parseClock('', '10:00:00', '+07:00')).toBeNull();
    expect(parseClock('2026-10-25', '', '+07:00')).toBeNull();
    expect(parseClock('bukan-tanggal', '10:00:00', '+07:00')).toBeNull();
    expect(parseClock('xyz/26/2026', '10:00:00', '+07:00')).toBeNull();
  });

  it('menerima offset negatif', () => {
    expect(iso(parseClock('2026-10-25', '20:00:00', '-05:00'))).toBe('2026-10-26T01:00:00.000Z');
  });
});

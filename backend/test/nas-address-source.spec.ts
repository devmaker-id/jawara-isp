import { describe, expect, it } from 'vitest';
import { subnetContains } from '../src/app/modules/mikrotik/mikrotik.service';

// Alamat NAS diambil dari rute connected yang mencakup alamat server RADIUS.
// Salah di sini berarti NAS didaftarkan dengan IP yang tidak pernah mengirim
// paket — FreeRADIUS membuang semuanya sebagai unknown client.
describe('subnetContains', () => {
  it('mengenali alamat di dalam subnet', () => {
    expect(subnetContains('192.168.100.0/24', '192.168.100.253')).toBe(true);
    expect(subnetContains('10.200.10.8/30', '10.200.10.9')).toBe(true);
    expect(subnetContains('172.23.40.0/24', '172.23.40.1')).toBe(true);
  });

  it('menolak alamat di luar subnet', () => {
    expect(subnetContains('192.168.100.0/24', '192.168.101.253')).toBe(false);
    expect(subnetContains('10.200.10.8/30', '10.200.10.12')).toBe(false);
    expect(subnetContains('192.168.100.0/24', '172.23.40.1')).toBe(false);
  });

  it('menangani /32 dan /0', () => {
    expect(subnetContains('172.23.40.1/32', '172.23.40.1')).toBe(true);
    expect(subnetContains('172.23.40.1/32', '172.23.40.2')).toBe(false);
    expect(subnetContains('0.0.0.0/0', '8.8.8.8')).toBe(true);
  });

  it('menolak masukan yang tidak valid tanpa melempar', () => {
    expect(subnetContains('bukan-cidr', '192.168.100.1')).toBe(false);
    expect(subnetContains('192.168.100.0/24', 'bukan-ip')).toBe(false);
    expect(subnetContains('192.168.100.0/33', '192.168.100.1')).toBe(false);
  });
});

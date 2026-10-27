import { describe, expect, it } from 'vitest';
import { freeRadiusDate, statusCheckAttributes, voucherStatusFor } from '../src/app/modules/customers/customer-radius';
import { limitReplyAttributes } from '../src/app/modules/profiles/rate-limit';

// Limitasi melekat pada GRUP (radgroupreply), bukan per user. Helper-nya kini
// dipakai pemetaan profil, bukan akun pelanggan — pengujiannya di sini tetap
// karena aturan angkanya sama.

const attr = (rows: Array<{ attribute: string; value: string }>) =>
  Object.fromEntries(rows.map((row) => [row.attribute, row.value]));

describe('limitReplyAttributes', () => {
  it('mengosongkan semua atribut bila tanpa batas', () => {
    expect(limitReplyAttributes({})).toEqual([]);
    expect(limitReplyAttributes({ timeLimitSeconds: 0, quotaLimitBytes: 0 })).toEqual([]);
    expect(limitReplyAttributes({ timeLimitSeconds: null, quotaLimitBytes: null })).toEqual([]);
  });

  it('batas waktu menjadi Session-Timeout dalam detik', () => {
    expect(attr(limitReplyAttributes({ timeLimitSeconds: 7200 }))).toEqual({
      'Session-Timeout': '7200',
    });
  });

  it('kuota kecil tetap satu atribut', () => {
    expect(attr(limitReplyAttributes({ quotaLimitBytes: 5_000_000_000 }))).toEqual({
      'Mikrotik-Total-Limit': String(5_000_000_000 % 4_294_967_296),
      'Mikrotik-Total-Limit-Gigawords': '1',
    });
  });

  it('kuota di bawah 4 GiB tidak memakai Gigawords', () => {
    const rows = limitReplyAttributes({ quotaLimitBytes: 1_000_000_000 });
    expect(attr(rows)).toEqual({ 'Mikrotik-Total-Limit': '1000000000' });
    expect(rows.map((row) => row.attribute)).not.toContain('Mikrotik-Total-Limit-Gigawords');
  });

  it('kuota besar dipecah ke Gigawords', () => {
    // 50 GB = 50e9 byte → 11 GiB penuh + sisa.
    const rows = limitReplyAttributes({ quotaLimitBytes: 50_000_000_000 });
    expect(attr(rows)['Mikrotik-Total-Limit-Gigawords']).toBe('11');
    expect(Number(attr(rows)['Mikrotik-Total-Limit'])).toBeLessThan(4_294_967_296);
  });
});

describe('statusCheckAttributes', () => {
  it('status aktif tidak menambah atribut apa pun', () => {
    expect(statusCheckAttributes('active')).toEqual([]);
  });

  it('suspend dan disable ditolak lewat Auth-Type := Reject', () => {
    for (const status of ['suspend', 'disable'] as const) {
      expect(statusCheckAttributes(status)).toEqual([
        { attribute: 'Auth-Type', op: ':=', value: 'Reject' },
      ]);
    }
  });

  it('expired memakai Expiration, bukan Auth-Type', () => {
    const rows = statusCheckAttributes('expired', new Date('2026-01-15T10:00:00'));
    expect(rows[0].attribute).toBe('Expiration');
    expect(rows[0].value).toBe('15 Jan 2026 10:00:00');
  });

  it('expired tanpa tanggal tetap menghasilkan waktu yang sudah lewat', () => {
    const rows = statusCheckAttributes('expired');
    expect(rows[0].attribute).toBe('Expiration');
    expect(rows[0].value).toMatch(/^\d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('freeRadiusDate', () => {
  it('memakai nama bulan Indonesia tanpa spasi tambahan', () => {
    expect(freeRadiusDate(new Date('2026-10-26T15:04:05'))).toBe('26 Okt 2026 15:04:05');
    expect(freeRadiusDate(new Date('2026-08-01T00:00:00'))).toBe('01 Agu 2026 00:00:00');
  });
});

describe('voucherStatusFor', () => {
  it('memetakan status pelanggan ke status akun', () => {
    expect(voucherStatusFor('active')).toBe('active');
    expect(voucherStatusFor('expired')).toBe('expired');
    // suspend/disable tetap punya akun agar bisa diaktifkan lagi tanpa
    // membuat username baru.
    expect(voucherStatusFor('suspend')).toBe('ready-to-use');
    expect(voucherStatusFor('disable')).toBe('ready-to-use');
  });
});

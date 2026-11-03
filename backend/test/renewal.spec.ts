import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  RenewalService,
  renewalAmount,
  renewalPeriod,
  unitToSeconds,
} from '../src/app/modules/renewals/renewal.service';

const DAY = 86_400;

describe('perhitungan periode perpanjangan', () => {
  it('pelanggan expired: mulai dari sekarang', () => {
    const now = new Date('2026-11-03T10:00:00');
    const { start, end } = renewalPeriod(new Date('2026-10-20T00:00:00'), now, 30 * DAY);
    expect(start.getTime()).toBe(now.getTime());
    expect(end.getTime() - start.getTime()).toBe(30 * DAY * 1000);
  });

  it('pelanggan masih aktif: sisa masa aktif tidak hangus', () => {
    const now = new Date('2026-11-03T10:00:00');
    const prev = new Date('2026-11-20T00:00:00');
    const { start, end } = renewalPeriod(prev, now, 30 * DAY);
    expect(start.getTime()).toBe(prev.getTime());
    expect(end.getTime()).toBe(prev.getTime() + 30 * DAY * 1000);
  });

  it('tanpa masa aktif sebelumnya: mulai dari sekarang', () => {
    const now = new Date('2026-11-03T10:00:00');
    expect(renewalPeriod(null, now, DAY).start.getTime()).toBe(now.getTime());
  });
});

describe('durasi dan harga', () => {
  it('menerjemahkan satuan masa aktif', () => {
    expect(unitToSeconds(30, 'day')).toBe(30 * DAY);
    expect(unitToSeconds(1, 'month')).toBe(30 * DAY);
    expect(unitToSeconds(6, 'hour')).toBe(6 * 3600);
    expect(unitToSeconds(0, 'day')).toBe(0);
  });

  it('memakai harga promo bila ada dan menambahkan pajak', () => {
    expect(renewalAmount({ sell_price: 150000, promo_price: 0, tax_percent: 0 }).total).toBe(150000);
    expect(renewalAmount({ sell_price: 150000, promo_price: 125000, tax_percent: 0 }).total).toBe(125000);
    const taxed = renewalAmount({ sell_price: 100000, promo_price: 0, tax_percent: 11 });
    expect(taxed.tax).toBe(11000);
    expect(taxed.total).toBe(111000);
  });
});

// Service diuji dengan repository tiruan: yang diperiksa adalah aturan akses
// dan urutan keputusan, bukan SQL.
function serviceWith(
  customer: unknown,
  account: unknown = null,
  profile: unknown = null,
  replay: unknown = null,
) {
  const repository = {
    byKey: async () => replay,
    customer: async () => customer,
    account: async () => account,
    profile: async () => profile,
    invoiceForPeriod: async () => null,
    apply: async () => ({ id: 1 }),
    history: async () => [],
  };
  const invoices = { create: async () => ({ id: 10, invoice_number: 'INV-X', amount: 1000 }) };
  const payments = {
    create: async () => ({ payment: { id: 20 }, invoice: {}, created: true }),
    void: async () => ({ payment: {}, invoice: {}, created: false }),
  };
  const db = { execute: async () => undefined };
  return new RenewalService(db as never, repository as never, invoices as never, payments as never);
}

const admin = { role: 'admin', userId: 1, isReseller: false, ownerId: null };
const reseller = (id: number) => ({ role: 'resseler', userId: id, isReseller: true, ownerId: id });

describe('idempotensi perpanjangan', () => {
  it('kunci yang sudah tercatat mengembalikan hasil lama tanpa menagih lagi', async () => {
    const service = serviceWith(null, null, null, {
      id: 7,
      account_id: 46,
      username: 'toni',
      period_end: new Date('2026-12-01T00:00:00'),
    });
    const result = await service.renew(
      54,
      { method: 'cash', idempotency_key: 'kunci-yang-sama' },
      admin,
      { id: 1, email: 'a@b.c', name: 'Admin', ip: '127.0.0.1' },
    );
    expect(result.replayed).toBe(true);
    expect(result.invoice).toBeNull();
  });
});

describe('aturan akses perpanjangan', () => {
  it('pelanggan di luar cakupan owner dianggap tidak ada', async () => {
    const service = serviceWith(null);
    await expect(service.preview(54, {}, reseller(9))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pelanggan tanpa akun layanan ditolak dengan pesan jelas', async () => {
    const service = serviceWith({ id: 54, name: 'Toni', status: 'active', internet_no: '1312016', owner_id: 1 }, null);
    await expect(service.preview(54, {}, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paket tanpa masa aktif tidak bisa diperpanjang', async () => {
    const service = serviceWith(
      { id: 54, name: 'Toni', status: 'active', internet_no: '1312016', owner_id: 1 },
      {
        id: 46,
        username: 'toni',
        password: 'x',
        profile_type: 'ppp',
        profile_id: 6,
        profile_name: '100k',
        status: 'active',
        expires_at: null,
        first_login_at: null,
      },
      {
        id: 6,
        name: '100k',
        radius_group: null,
        sell_price: 125000,
        promo_price: 0,
        tax_percent: 0,
        validity_value: 0,
        validity_unit: 'day',
        is_active: 1,
      },
    );
    await expect(service.preview(54, {}, admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pelanggan suspend tidak bisa diperpanjang', async () => {
    const service = serviceWith(
      { id: 54, name: 'Toni', status: 'suspend', internet_no: '1312016', owner_id: 1 },
      {
        id: 46,
        username: 'toni',
        password: 'x',
        profile_type: 'ppp',
        profile_id: 6,
        profile_name: '100k',
        status: 'expired',
        expires_at: new Date('2026-10-01T00:00:00'),
        first_login_at: null,
      },
      {
        id: 6,
        name: '100k',
        radius_group: null,
        sell_price: 125000,
        promo_price: 0,
        tax_percent: 0,
        validity_value: 30,
        validity_unit: 'day',
        is_active: 1,
      },
    );
    await expect(
      service.renew(54, { method: 'cash' }, admin, {
        id: 1,
        email: 'a@b.c',
        name: 'Admin',
        ip: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
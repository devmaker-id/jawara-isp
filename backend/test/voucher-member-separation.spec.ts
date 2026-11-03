import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SalesService } from '../src/app/modules/sales/sales.service';

// Pelanggan PPPoE (user_type='member') dan voucher PPPoE (user_type='voucher')
// berada di tabel yang sama (radius_vouchers) tetapi bukan barang yang sama.
// Penjualan voucher tidak boleh menunjuk akun pelanggan.

function serviceWith(voucherRow: Record<string, unknown> | null) {
  const db = {
    queryOne: async () => voucherRow,
    query: async () => [],
    execute: async () => undefined,
  };
  const repository = { create: async () => 1, list: async () => ({ rows: [], total: 0 }) };
  return new SalesService(db as never, repository as never);
}

describe('penjualan voucher tidak menerima akun pelanggan', () => {
  it('menolak voucher_id yang menunjuk akun member', async () => {
    const service = serviceWith({
      id: 5,
      username: 'toni',
      profile_name: 'PPPoE-10M',
      profile_type: 'ppp',
      owner_id: null,
      price: 150000,
      user_type: 'member',
    });

    await expect(
      service.createSale({ voucher_id: 5, sell_price: 150000 } as never, {
        userId: 1,
        ip: '127.0.0.1',
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

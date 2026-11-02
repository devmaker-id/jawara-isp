import { describe, expect, it, vi } from 'vitest';
import { VoucherUsageService } from '../src/app/modules/reports/voucher-usage.service';
import { SYSTEM_SCOPE, RequestScope } from '../src/app/modules/auth/request-scope';
import type { DatabaseService } from '../src/app/database/database.service';

// Mock DatabaseService: tidak ada koneksi ke database pada test ini.
function makeDb(rows: unknown[] = []) {
  const db = {
    query: vi.fn().mockResolvedValue(rows),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 0 }),
  };
  return { db: db as unknown as DatabaseService, raw: db };
}

const scope = (overrides: Partial<RequestScope>): RequestScope => ({
  role: 'resseler',
  userId: 42,
  isReseller: true,
  ownerId: 42,
  ...overrides,
});

describe('VoucherUsageService', () => {
  it('admin: tanpa filter pemilik dan tanggal memakai zona Asia/Jakarta', async () => {
    const { db, raw } = makeDb();
    await new VoucherUsageService(db).summary('2026-10-01', '2026-10-31', SYSTEM_SCOPE);

    const [sql, params] = raw.query.mock.calls[0];
    expect(sql).toContain("p.reply = 'Access-Accept'");
    expect(sql).toContain('MIN(p.authdate)');
    expect(sql).toContain('GROUP BY p.username');
    expect(sql).toContain("CONVERT_TZ(f.first_at, @@session.time_zone, '+07:00')");
    expect(sql).toContain("v.user_type = 'voucher'");
    expect(sql).toContain('v.username = f.username');
    expect(sql).not.toContain('v.owner_id = ?');
    expect(params).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('reseller: hanya stok miliknya', async () => {
    const { db, raw } = makeDb();
    await new VoucherUsageService(db).summary(undefined, undefined, scope({}));

    const [sql, params] = raw.query.mock.calls[0];
    expect(sql).toContain('v.owner_id = ?');
    expect(params).toEqual([42]);
  });

  it('operator: stok miliknya atau yang ia buat', async () => {
    const { db, raw } = makeDb();
    await new VoucherUsageService(db).summary(
      undefined,
      undefined,
      scope({ role: 'operator', isReseller: false, ownerId: null }),
    );

    const [sql, params] = raw.query.mock.calls[0];
    expect(sql).toContain('(v.owner_id = ? OR v.created_by = ?)');
    expect(params).toEqual([42, 42]);
  });

  it('identitas tanpa id sah: gagal-tertutup (1 = 0)', async () => {
    const { db, raw } = makeDb();
    await new VoucherUsageService(db).summary(
      undefined,
      undefined,
      scope({ userId: null, ownerId: null }),
    );

    const [sql, params] = raw.query.mock.calls[0];
    expect(sql).toContain('1 = 0');
    expect(params).toEqual([]);
  });

  it('memetakan baris dan menjumlahkan total per agen', async () => {
    const { db } = makeDb([
      {
        tanggal: '2026-10-26',
        owner_id: 1,
        agen: 'Administrator',
        profile_name: 'UJI-T1-PPP',
        profile_type: 'ppp',
        harga_jual: '10000.00',
        harga_modal: '5000.00',
        voucher_unik: 1,
        total_jual: '10000.00',
        estimasi_modal: '5000.00',
      },
      {
        tanggal: '2026-10-25',
        owner_id: null,
        agen: 'Tanpa pemilik',
        profile_name: '2 hari 6 jam',
        profile_type: 'hotspot',
        harga_jual: '2000.00',
        harga_modal: null,
        voucher_unik: 2,
        total_jual: '4000.00',
        estimasi_modal: '0.00',
      },
    ]);

    const report = await new VoucherUsageService(db).summary(undefined, undefined, SYSTEM_SCOPE);

    expect(report.rows[0].harga_jual).toBe(10000);
    expect(report.rows[1].atribusi).toBe('tanpa-pemilik');
    expect(report.rows[1].harga_modal).toBeNull();
    expect(report.total_vouchers).toBe(3);
    expect(report.estimasi_modal).toBe(5000);
    expect(report.by_owner).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PoolConnection } from 'mysql2/promise';
import {
  FinanceEventsRepository,
  writeFinanceEvent,
} from '../src/app/modules/finance/finance-events.repository';
import type { DatabaseService } from '../src/app/database/database.service';

const actor = {
  id: 4,
  email: 'operator@uji.test',
  name: 'Operator Uji',
  ip: '10.0.0.9',
};

function fakeConn() {
  const query = vi.fn().mockResolvedValue([[], []]);
  return { conn: { query } as unknown as PoolConnection, query };
}

describe('writeFinanceEvent', () => {
  it('menulis INSERT append-only dengan snapshot pelaku', async () => {
    const { conn, query } = fakeConn();

    await writeFinanceEvent(conn, {
      entityType: 'invoice',
      entityId: 12,
      action: 'INVOICE_VOIDED',
      before: { status: 'unpaid' },
      after: { status: 'void' },
      reason: '  salah periode  ',
      actor,
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO finance_events');
    expect(sql).not.toMatch(/UPDATE|DELETE/);
    expect(params).toEqual([
      'invoice',
      12,
      'INVOICE_VOIDED',
      JSON.stringify({ status: 'unpaid' }),
      JSON.stringify({ status: 'void' }),
      // Alasan di-trim; spasi saja menjadi NULL.
      'salah periode',
      4,
      'Operator Uji',
      '10.0.0.9',
    ]);
  });

  it('menyimpan NULL bila snapshot/alasan tidak ada', async () => {
    const { conn, query } = fakeConn();

    await writeFinanceEvent(conn, {
      entityType: 'payment',
      entityId: 3,
      action: 'PAYMENT_CREATED',
      reason: '   ',
      actor,
    });

    const [, params] = query.mock.calls[0];
    expect(params.slice(3, 6)).toEqual([null, null, null]);
  });

  it('memotong nama (>100) dan IP (>45) agar tidak melampaui kolom', async () => {
    const { conn, query } = fakeConn();

    await writeFinanceEvent(conn, {
      entityType: 'payment',
      entityId: 3,
      action: 'PAYMENT_CREATED',
      actor: { ...actor, name: 'N'.repeat(150), ip: '1'.repeat(60) },
    });

    const [, params] = query.mock.calls[0];
    expect(String(params[7])).toHaveLength(100);
    expect(String(params[8])).toHaveLength(45);
  });

  it('meneruskan kegagalan INSERT ke pemanggil (transaksi ikut rollback)', async () => {
    const query = vi.fn().mockRejectedValue(new Error('Unknown table finance_events'));
    const conn = { query } as unknown as PoolConnection;

    await expect(
      writeFinanceEvent(conn, {
        entityType: 'invoice',
        entityId: 1,
        action: 'INVOICE_CREATED',
        actor,
      }),
    ).rejects.toThrow('Unknown table finance_events');
  });
});

describe('FinanceEventsRepository.list', () => {
  const makeDb = (rows: unknown[]) =>
    ({ query: vi.fn().mockResolvedValue(rows) }) as unknown as DatabaseService;

  it('memfilter per entitas dan mengurutkan terbaru lebih dulu', async () => {
    const db = makeDb([]);
    await new FinanceEventsRepository(db).list('invoice', 7);

    const [sql, params] = (db as unknown as { query: ReturnType<typeof vi.fn> }).query.mock.calls[0];
    expect(sql).toMatch(/FROM finance_events/);
    expect(sql).toMatch(/ORDER BY id DESC/);
    expect(params).toEqual(['invoice', 7]);
  });

  it('mengurai JSON before/after dan membiarkan JSON rusak menjadi null', async () => {
    const db = makeDb([
      {
        id: 2,
        entity_type: 'invoice',
        entity_id: 7,
        action: 'INVOICE_UPDATED',
        before_json: '{"amount":1000}',
        after_json: '{"amount":2000}',
        reason: null,
        actor_id: 1,
        actor_name: 'Admin',
        ip_address: '127.0.0.1',
        created_at: new Date('2026-03-02T01:00:00Z'),
      },
      {
        id: 1,
        entity_type: 'invoice',
        entity_id: 7,
        action: 'INVOICE_CREATED',
        before_json: null,
        after_json: '{rusak',
        reason: null,
        actor_id: 1,
        actor_name: 'Admin',
        ip_address: '127.0.0.1',
        created_at: new Date('2026-03-01T01:00:00Z'),
      },
    ]);

    const rows = await new FinanceEventsRepository(db).list('invoice', 7);

    expect(rows[0].before_json).toEqual({ amount: 1000 });
    expect(rows[0].after_json).toEqual({ amount: 2000 });
    expect(rows[1].before_json).toBeNull();
    expect(rows[1].after_json).toBeNull();
  });
});
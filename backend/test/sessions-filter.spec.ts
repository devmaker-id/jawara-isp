import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { SessionsRepository } from '../src/app/modules/sessions/sessions.repository';
import type { DatabaseService } from '../src/app/database/database.service';

// Filter jenis akun (voucher vs member) dipakai tautan dashboard
// /sesi?jenis=hotspot&user_type=voucher. Filter ini harus di SQL, bukan di
// peramban, supaya pagination dan total ikut benar.
function makeRepo() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { total: 0 };
    }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return [];
    }),
  } as unknown as DatabaseService;
  return { repo: new SessionsRepository(db), calls };
}

const lastParams = (calls: Array<{ sql: string; params: unknown[] }>) =>
  calls.filter((call) => call.sql.includes('radacct'))[0] ?? { sql: '', params: [] };

describe('SessionsRepository — filter jenis akun', () => {
  it('menyaring sesi hotspot voucher di SQL', async () => {
    const { repo, calls } = makeRepo();
    await repo.list({ jenis: 'hotspot', userType: 'voucher' });

    const { sql, params } = lastParams(calls);
    expect(sql).toContain('v.user_type = ?');
    expect(params).toEqual(['hotspot', 'voucher']);
  });

  it('menyaring sesi hotspot member', async () => {
    const { repo, calls } = makeRepo();
    await repo.list({ jenis: 'hotspot', userType: 'member' });

    expect(lastParams(calls).params).toEqual(['hotspot', 'member']);
  });

  it('tanpa user_type: semua jenis akun ikut (perilaku lama)', async () => {
    const { repo, calls } = makeRepo();
    await repo.list({ jenis: 'ppp' });

    const { sql, params } = lastParams(calls);
    expect(sql).not.toContain('v.user_type = ?');
    expect(params).toEqual(['ppp']);
  });
});

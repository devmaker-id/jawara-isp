import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OltService } from '../src/app/modules/olt/olt.service';
import type { OltRepository } from '../src/app/modules/olt/olt.repository';

// Aturan yang diuji: satu pelanggan maksimal satu ONU, ONU yang sudah dipakai
// pelanggan lain tidak boleh dicabut diam-diam, dan setiap pemasangan/pelepasan
// meninggalkan jejak.

const actor = { userId: 1, ip: '127.0.0.1' };

function makeRepo() {
  return {
    findCustomer: vi.fn().mockResolvedValue({ id: 54, name: 'Toni Gajrug', internet_no: '1312016' }),
    assignOnu: vi.fn().mockResolvedValue({ action: 'assign', previousCustomerId: null }),
    releaseOnu: vi.fn().mockResolvedValue({ previousCustomerId: 54 }),
    findOnu: vi.fn().mockResolvedValue({ id: 1, serial_number: 'ZICG295ebcf2' }),
    onuHistory: vi.fn().mockResolvedValue([]),
    onusOfCustomer: vi.fn().mockResolvedValue([]),
  } as unknown as OltRepository;
}

function makeService(repo: OltRepository) {
  const db = { execute: vi.fn().mockResolvedValue({ affectedRows: 1 }) };
  return { service: new OltService(db as never, repo, {} as never), db };
}

describe('OltService — pemasangan ONU', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: OltService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo as unknown as OltRepository).service;
  });

  it('memasang ONU memakai Nomor Internet pelanggan', async () => {
    const hasil = await service.assignOnu(1, { internet_no: '1312016' }, actor);

    expect(repo.findCustomer).toHaveBeenCalledWith({ id: undefined, internetNo: '1312016' });
    expect(repo.assignOnu).toHaveBeenCalledWith({
      onuId: 1,
      customerId: 54,
      actorId: 1,
      note: undefined,
      move: false,
    });
    expect(hasil).toMatchObject({ ok: true, customer_id: 54, internet_no: '1312016' });
  });

  it('Nomor Internet yang tidak dikenal menghasilkan 404', async () => {
    vi.mocked(repo.findCustomer).mockResolvedValue(null);
    await expect(service.assignOnu(1, { internet_no: '9999999' }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.assignOnu).not.toHaveBeenCalled();
  });

  it('menolak ONU yang sudah terpasang di pelanggan lain (tanpa move)', async () => {
    vi.mocked(repo.assignOnu).mockRejectedValue(
      Object.assign(new Error('ONU sudah dipakai pelanggan lain'), { code: 'ONU_TAKEN' }),
    );
    await expect(service.assignOnu(1, { internet_no: '1312016' }, actor)).rejects.toThrow(
      /sudah terpasang di pelanggan lain/,
    );
  });

  it('menolak pelanggan yang sudah punya ONU', async () => {
    vi.mocked(repo.assignOnu).mockRejectedValue(
      Object.assign(new Error('Pelanggan sudah punya ONU'), { code: 'CUSTOMER_HAS_ONU' }),
    );
    await expect(service.assignOnu(1, { internet_no: '1312016' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('meneruskan permintaan pindah hanya bila diminta eksplisit', async () => {
    vi.mocked(repo.assignOnu).mockResolvedValue({ action: 'move', previousCustomerId: 55 });
    const hasil = await service.assignOnu(1, { internet_no: '1312016', move: true }, actor);
    expect(vi.mocked(repo.assignOnu).mock.calls[0][0]).toMatchObject({ move: true });
    expect(hasil.action).toBe('move');
  });

  it('melepas ONU mengembalikan pelanggan sebelumnya', async () => {
    const hasil = await service.releaseOnu(1, 'ganti perangkat', actor);
    expect(hasil).toEqual({ ok: true, onu_id: 1, previous_customer_id: 54 });
    expect(repo.releaseOnu).toHaveBeenCalledWith({
      onuId: 1,
      actorId: 1,
      note: 'ganti perangkat',
    });
  });

  it('menulis audit pemasangan dan pelepasan', async () => {
    const { service: svc, db } = makeService(repo as unknown as OltRepository);
    await svc.assignOnu(1, { internet_no: '1312016' }, actor);
    await svc.releaseOnu(1, undefined, actor);
    const aksi = vi.mocked(db.execute).mock.calls.map((call) => call[1]?.[1]);
    expect(aksi).toContain('olt.onu.assign');
    expect(aksi).toContain('olt.onu.release');
  });

  it('riwayat ONU yang tidak ada menghasilkan 404', async () => {
    vi.mocked(repo.findOnu).mockResolvedValue(null);
    await expect(service.onuHistory(99)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Migrasi 029 — struktur relasi ONU', () => {
  const sql = readFileSync(resolve(__dirname, '../migrations/029_onu_customer.sql'), 'utf8');

  it('menambah kolom customer_id yang boleh NULL', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS customer_id INT NULL/);
  });

  it('menegakkan satu ONU per pelanggan di level database', () => {
    expect(sql).toContain('uq_onus_customer');
  });

  it('menjaga ONU tetap ada saat pelanggan dihapus', () => {
    expect(sql).toMatch(/ON DELETE SET NULL/);
  });

  it('membuat tabel riwayat pemasangan', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS onu_assignment_history');
    expect(sql).toMatch(/ENUM\('assign', 'release', 'move'\)/);
  });

  it('tidak memetakan ONU lama secara otomatis', () => {
    expect(sql).not.toMatch(/UPDATE\s+olt_onus/i);
  });
});

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/app/modules/settings/settings.service';
import type { SettingsRepository } from '../src/app/modules/settings/settings.repository';
import { SETTING_DEFAULTS } from '../src/app/modules/settings/settings.keys';

// Angka awal Nomor Internet hanya boleh menggeser titik mulai KE DEPAN.
// Kalau nilai yang lebih kecil diterima, nomor berikutnya akan menabrak nomor
// yang sudah terbit — dan nomor pelanggan tidak boleh dipakai dua kali.

function makeRepo() {
  return {
    findValues: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue(undefined),
    // 6 pelanggan sudah bernomor 1312013..1312018, penghitung di seq 8
    internetNoState: vi.fn().mockResolvedValue({ maxIssued: 1312018, lastSeq: 8 }),
  } as unknown as SettingsRepository;
}

describe('Settings — angka awal Nomor Internet', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: SettingsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new SettingsService(repo);
  });

  it('menolak nilai bukan angka', async () => {
    await expect(service.update({ internet_no_start: '1312-013' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('menolak angka awal yang membuat nomor berikutnya bertabrakan', async () => {
    // 1312000 + 8 = 1312008, padahal 1312018 sudah terbit
    await expect(service.update({ internet_no_start: '1312000' })).rejects.toThrow(
      /bertabrakan dengan nomor 1312018/,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('menyebut angka minimal yang aman di pesan penolakan', async () => {
    await expect(service.update({ internet_no_start: '1312000' })).rejects.toThrow(/minimal 1312011/);
  });

  it('menerima angka awal yang meneruskan penomoran', async () => {
    // 1312013 + 8 = 1312021 > 1312018 → aman
    await service.update({ internet_no_start: '1312013' });
    expect(repo.upsert).toHaveBeenCalledWith({ internet_no_start: '1312013' });
  });

  it('menerima nilai kosong (penomoran otomatis dimatikan)', async () => {
    await service.update({ internet_no_start: '' });
    expect(repo.upsert).toHaveBeenCalledWith({ internet_no_start: '' });
    expect(repo.internetNoState).not.toHaveBeenCalled();
  });

  it('tidak pernah mengubah penghitung saat angka awal disimpan', async () => {
    await service.update({ internet_no_start: '1312013' });
    // Satu-satunya penulisan adalah nilai config; tidak ada reset sequence.
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.upsert).toHaveBeenCalledWith({ internet_no_start: '1312013' });
  });

  it('default kosong berarti penomoran mati', () => {
    expect(SETTING_DEFAULTS.internet_no_start).toBe('');
  });
});

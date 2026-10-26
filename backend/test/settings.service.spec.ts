import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SettingsRepository } from '../src/app/modules/settings/settings.repository';
import { SettingsService } from '../src/app/modules/settings/settings.service';
import { SECRET_MASK } from '../src/app/modules/settings/settings.keys';

function makeService(overrides: Record<string, unknown> = {}) {
  const saved: Record<string, string>[] = [];
  const base = {
    findValues: vi.fn().mockResolvedValue({}),
    upsert: vi.fn(async (values: Record<string, string>) => {
      saved.push(values);
    }),
    ...overrides,
  };
  return {
    service: new SettingsService(base as unknown as SettingsRepository),
    raw: base,
    saved,
  };
}

describe('SettingsService', () => {
  it('menggabungkan nilai tersimpan dengan default', async () => {
    const { service } = makeService({
      findValues: vi.fn().mockResolvedValue({ brand_name: 'BibitNet Nanggela' }),
    });
    const view = await service.get();

    expect(view.values.brand_name).toBe('BibitNet Nanggela');
    expect(view.values.brand_tagline).toBe('Internet Cepat & Stabil');
    expect(Object.keys(view.groups)).toEqual(['branding', 'payment', 'telegram', 'whatsapp', 'integrasi']);
  });

  it('tidak pernah mengirim nilai rahasia, hanya status terisi', async () => {
    const { service } = makeService({
      findValues: vi
        .fn()
        .mockResolvedValue({ telegram_bot_token: '123456:rahasia', whatsapp_api_token: '' }),
    });
    const view = await service.get();

    expect(view.values.telegram_bot_token).toBe(SECRET_MASK);
    expect(view.secrets_set.telegram_bot_token).toBe(true);
    expect(view.secrets_set.whatsapp_api_token).toBe(false);
    expect(JSON.stringify(view)).not.toContain('rahasia');
  });

  it('menolak kunci di luar daftar putih', async () => {
    const { service, raw } = makeService();
    await expect(service.update({ db_root_password: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(raw.upsert).not.toHaveBeenCalled();
  });

  // Password API router dan secret RADIUS kini boleh diisi dari Pengaturan,
  // tetapi harus tetap disamarkan seperti token lain.
  it('menyamarkan password MikroTik dan secret FreeRADIUS', async () => {
    const { service } = makeService({
      findValues: vi
        .fn()
        .mockResolvedValue({ mikrotik_password: 'rahasia-router', freeradius_secret: 'rahasia-radius' }),
    });
    const view = await service.get();

    expect(view.values.mikrotik_password).toBe(SECRET_MASK);
    expect(view.values.freeradius_secret).toBe(SECRET_MASK);
    expect(view.secrets_set.mikrotik_password).toBe(true);
    expect(view.secrets_set.freeradius_secret).toBe(true);
    expect(JSON.stringify(view)).not.toContain('rahasia-router');
  });

  it('menerima kunci integrasi yang sah', async () => {
    const { service, raw } = makeService();
    await service.update({ mikrotik_host: '192.168.100.254', mikrotik_write_enabled: '0' });
    expect(raw.upsert).toHaveBeenCalledOnce();
  });

  it('menolak nilai bukan teks', async () => {
    const { service } = makeService();
    await expect(service.update({ brand_name: 123 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('menolak payment_mode di luar manual/gateway', async () => {
    const { service } = makeService();
    await expect(service.update({ payment_mode: 'kripto' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('menolak telegram_enabled/whatsapp_enabled selain 0/1', async () => {
    const { service } = makeService();
    await expect(service.update({ telegram_enabled: 'ya' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('placeholder rahasia tidak menimpa token yang tersimpan', async () => {
    const { service, saved } = makeService();
    await service.update({
      telegram_bot_token: SECRET_MASK,
      whatsapp_api_token: '',
      brand_name: 'BibitNet',
    });

    expect(saved[0]).toEqual({ brand_name: 'BibitNet' });
  });

  it('token baru tetap disimpan bila diisi', async () => {
    const { service, saved } = makeService();
    await service.update({ whatsapp_api_token: 'token-baru-123' });
    expect(saved[0]).toEqual({ whatsapp_api_token: 'token-baru-123' });
  });

  it('menolak permintaan tanpa nilai', async () => {
    const { service } = makeService();
    await expect(service.update({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('database tidak tersedia → 503', async () => {
    const { service } = makeService({
      findValues: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })),
    });
    await expect(service.get()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

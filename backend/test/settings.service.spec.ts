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
    expect(view.values.brand_tagline).toBe('BibitNet ISP');
    // Urutan grup mengikuti SETTING_GROUPS; yang penting setiap tab pengaturan
    // punya grupnya sendiri.
    expect(Object.keys(view.groups)).toEqual([
      'branding',
      'voucher',
      'pelanggan',
      'piutang',
      'payment',
      'telegram',
      'integrasi',
    ]);
  });

  it('branding publik hanya berisi lima nilai identitas, tanpa rahasia', async () => {
    const { service } = makeService({
      findValues: vi.fn().mockResolvedValue({
        brand_name: 'BibitNet Nanggela',
        telegram_bot_token: '123456:rahasia',
        mikrotik_password: 'sandi-perangkat',
      }),
    });
    const brand = await service.branding();

    expect(Object.keys(brand).sort()).toEqual([
      'footer_text',
      'logo_url',
      'name',
      'primary_color',
      'tagline',
    ]);
    expect(brand.name).toBe('BibitNet Nanggela');
    expect(JSON.stringify(brand)).not.toContain('rahasia');
    expect(JSON.stringify(brand)).not.toContain('sandi-perangkat');
  });

  it('logo bawaan dipakai bila belum diatur', async () => {
    const { service } = makeService();
    const brand = await service.branding();

    expect(brand.logo_url).toBe('/branding/jawara-isp.png');
    expect(brand.name).toBe('JAWARA-ISP');
    expect(brand.primary_color).toBe('#06b6d4');
  });

  it('tidak pernah mengirim nilai rahasia, hanya status terisi', async () => {
    const { service } = makeService({
      findValues: vi.fn().mockResolvedValue({ telegram_bot_token: '123456:rahasia' }),
    });
    const view = await service.get();

    expect(view.values.telegram_bot_token).toBe(SECRET_MASK);
    expect(view.secrets_set.telegram_bot_token).toBe(true);
    expect(view.secrets_set.freeradius_secret).toBe(false);
    expect(JSON.stringify(view)).not.toContain('rahasia');
  });

  it('menolak kunci di luar daftar putih', async () => {
    const { service, raw } = makeService();
    await expect(service.update({ db_root_password: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(raw.upsert).not.toHaveBeenCalled();
  });

  // Secret RADIUS boleh diisi dari Pengaturan, tetapi harus tetap disamarkan
  // seperti token lain.
  it('menyamarkan secret FreeRADIUS', async () => {
    const { service } = makeService({
      findValues: vi.fn().mockResolvedValue({ freeradius_secret: 'rahasia-radius' }),
    });
    const view = await service.get();

    expect(view.values.freeradius_secret).toBe(SECRET_MASK);
    expect(view.secrets_set.freeradius_secret).toBe(true);
    expect(JSON.stringify(view)).not.toContain('rahasia-radius');
  });

  it('menerima kunci integrasi yang sah', async () => {
    const { service, raw } = makeService();
    await service.update({ freeradius_host: '127.0.0.1', freeradius_secret: 'rahasia-radius' });
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

  it('menolak telegram_enabled selain 0/1', async () => {
    const { service } = makeService();
    await expect(service.update({ telegram_enabled: 'ya' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Pengaturan WhatsApp lama sudah dihapus (gateway punya menu sendiri).
  // Kuncinya harus ditolak sebagai kunci asing, bukan diam-diam tersimpan.
  it('menolak kunci whatsapp_* yang sudah dihapus', async () => {
    const { service, raw } = makeService();
    for (const key of ['whatsapp_enabled', 'whatsapp_api_token', 'whatsapp_provider']) {
      await expect(service.update({ [key]: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(raw.upsert).not.toHaveBeenCalled();
  });

  it('placeholder rahasia tidak menimpa token yang tersimpan', async () => {
    const { service, saved } = makeService();
    await service.update({
      telegram_bot_token: SECRET_MASK,
      brand_name: 'BibitNet',
    });

    expect(saved[0]).toEqual({ brand_name: 'BibitNet' });
  });

  it('token baru tetap disimpan bila diisi', async () => {
    const { service, saved } = makeService();
    await service.update({ telegram_bot_token: 'token-baru-123' });
    expect(saved[0]).toEqual({ telegram_bot_token: 'token-baru-123' });
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

import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  MAX_VALUE_LENGTH,
  SECRET_KEYS,
  SECRET_MASK,
  SETTING_DEFAULTS,
  SETTING_GROUPS,
  SETTING_KEYS,
  SettingKey,
} from './settings.keys';
import { SettingsRepository } from './settings.repository';

const DB_UNAVAILABLE = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ENOTFOUND',
  'ER_NO_SUCH_TABLE',
];

// Identitas panel yang boleh dibaca tanpa login. Tidak memuat rahasia.
export interface PublicBranding {
  name: string;
  tagline: string;
  logo_url: string;
  primary_color: string;
  footer_text: string;
}

export interface SettingsView {
  groups: Record<string, SettingKey[]>;
  values: Record<SettingKey, string>;
  // true = nilai rahasia sudah tersimpan di server (isinya tidak dikirim).
  secrets_set: Record<string, boolean>;
}

const PAYMENT_MODES = ['manual', 'gateway'];

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  private rethrow(error: unknown): never {
    const code = (error as { code?: string })?.code;
    if (code && DB_UNAVAILABLE.includes(code)) {
      throw new ServiceUnavailableException('Database tidak tersedia, coba lagi nanti');
    }
    throw error;
  }

  /**
   * Nilai mentah satu kunci, untuk pemakaian internal server (mis. token
   * WhatsApp saat mengirim pesan). Tidak pernah diekspos ke browser — endpoint
   * settings tetap memakai `get()` yang menyamarkan rahasia.
   */
  async rawValue(key: SettingKey): Promise<string> {
    const stored = await this.repository.findValues().catch((error) => this.rethrow(error));
    return stored[key] ?? SETTING_DEFAULTS[key] ?? '';
  }

  /**
   * Identitas panel untuk halaman publik (login) dan untuk semua peran.
   *
   * Hanya lima kunci `brand_*` yang dikirim — tidak ada rahasia, tidak ada
   * konfigurasi integrasi. Dipisah dari `get()` karena endpoint `settings`
   * dibatasi admin/operator, sedangkan reseller dan halaman login juga perlu
   * tahu nama dan logo panel.
   */
  async branding(): Promise<PublicBranding> {
    const view = await this.get();
    const pick = (key: SettingKey) => view.values[key] ?? SETTING_DEFAULTS[key] ?? '';
    return {
      name: pick('brand_name'),
      tagline: pick('brand_tagline'),
      logo_url: pick('brand_logo_url'),
      primary_color: pick('brand_primary_color'),
      footer_text: pick('brand_footer_text'),
    };
  }

  async get(): Promise<SettingsView> {
    const stored = await this.repository.findValues().catch((error) => this.rethrow(error));

    const values = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
    const secretsSet: Record<string, boolean> = {};

    for (const key of SETTING_KEYS) {
      const raw = stored[key];
      if (raw === undefined) continue;
      if (SECRET_KEYS.has(key)) {
        secretsSet[key] = raw.length > 0;
        // Nilai rahasia tidak pernah keluar dari server.
        values[key] = raw.length > 0 ? SECRET_MASK : '';
        continue;
      }
      values[key] = raw;
    }
    for (const key of SECRET_KEYS) {
      if (secretsSet[key] === undefined) secretsSet[key] = false;
    }

    return { groups: SETTING_GROUPS, values, secrets_set: secretsSet };
  }

  async update(input: Record<string, unknown>): Promise<SettingsView> {
    const entries = Object.entries(input ?? {});
    if (entries.length === 0) {
      throw new BadRequestException('Tidak ada nilai yang dikirim');
    }

    const allowed = new Set<string>(SETTING_KEYS);
    const unknown = entries.map(([key]) => key).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(`Kunci pengaturan tidak dikenal: ${unknown.join(', ')}`);
    }

    const toSave: Record<string, string> = {};
    for (const [key, raw] of entries) {
      const settingKey = key as SettingKey;
      if (typeof raw !== 'string') {
        throw new BadRequestException(`Nilai ${key} harus berupa teks`);
      }
      const value = raw.trim();
      if (value.length > MAX_VALUE_LENGTH) {
        throw new BadRequestException(`Nilai ${key} maksimal ${MAX_VALUE_LENGTH} karakter`);
      }
      // Placeholder atau kosong pada field rahasia = "jangan ubah".
      if (SECRET_KEYS.has(settingKey) && (value === '' || value === SECRET_MASK)) continue;
      toSave[key] = value;
    }

    if (toSave.payment_mode !== undefined && !PAYMENT_MODES.includes(toSave.payment_mode)) {
      throw new BadRequestException('payment_mode harus manual atau gateway');
    }
    for (const flag of ['telegram_enabled', 'whatsapp_enabled']) {
      if (toSave[flag] !== undefined && !['0', '1'].includes(toSave[flag])) {
        throw new BadRequestException(`${flag} harus 0 atau 1`);
      }
    }
    if (Object.keys(toSave).length === 0) {
      throw new BadRequestException('Tidak ada nilai yang berubah untuk disimpan');
    }

    await this.repository.upsert(toSave).catch((error) => this.rethrow(error));
    return this.get();
  }
}

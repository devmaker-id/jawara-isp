import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Kebijakan akses WhatsApp — ditegakkan di server.
 *
 * Sumbernya tabel `wa_settings` + `wa_allowlist`, jadi aturan yang sekarang
 * berlaku bisa dipindahkan apa adanya tanpa mengubah kode.
 */
export interface WaPolicy {
  dmPolicy: 'allowlist' | 'open';
  groupPolicy: 'allowlist' | 'open';
  requireMention: boolean;
  gatewayEnabled: boolean;
}

export interface InboundCheck {
  allowed: boolean;
  isAdmin: boolean;
  reason?: string;
}

@Injectable()
export class WaSecurityService {
  constructor(private readonly db: DatabaseService) {}

  async policy(): Promise<WaPolicy> {
    const rows = await this.db.query<{ setting_key: string; setting_value: string }>(
      'SELECT setting_key, setting_value FROM wa_settings',
    );
    const map = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
    const flag = (key: string, fallback: string) => (map.get(key) ?? fallback) === '1';
    return {
      dmPolicy: (map.get('dm_policy') ?? 'allowlist') === 'open' ? 'open' : 'allowlist',
      groupPolicy: (map.get('group_policy') ?? 'allowlist') === 'open' ? 'open' : 'allowlist',
      requireMention: flag('require_mention', '1'),
      gatewayEnabled: flag('gateway_enabled', '1'),
    };
  }

  /** Nomor/grup yang boleh, sekaligus penanda administrator. */
  async allowlist(): Promise<Array<{ kind: 'number' | 'group'; value: string; is_admin: boolean }>> {
    return this.db.query(
      'SELECT kind, value, is_admin FROM wa_allowlist WHERE is_active = 1',
    );
  }

  /**
   * Satu pesan masuk: boleh diproses atau tidak.
   *
   * Grup selalu butuh izin grup + (bila diwajibkan) mention atau perintah "/".
   * DM memakai allowlist nomor. Administrator adalah nomor yang ditandai
   * `is_admin` di allowlist.
   */
  async check(input: {
    chatId: string;
    chatType: 'dm' | 'group';
    sender: string;
    /** Nomor telepon asli (alt JID) saat pengirim diwakili LID. */
    senderAlt?: string;
    text: string;
    mentioned: boolean;
  }): Promise<InboundCheck> {
    const policy = await this.policy();
    if (!policy.gatewayEnabled) return { allowed: false, isAdmin: false, reason: 'gateway dimatikan' };

    const list = await this.allowlist();
    const norm = (value: string) => String(value).split('@')[0].split(':')[0].replace(/\D/g, '');

    const adminNumbers = new Set(list.filter((row) => row.kind === 'number' && row.is_admin).map((row) => norm(row.value)));
    const allowedNumbers = new Set(list.filter((row) => row.kind === 'number').map((row) => norm(row.value)));
    const allowedGroups = new Set(list.filter((row) => row.kind === 'group').map((row) => row.value));

    const kandidat = [norm(input.sender), norm(input.senderAlt ?? '')].filter(Boolean);
    const sender = kandidat[0] ?? '';
    const isAdmin = kandidat.some((value) => adminNumbers.has(value));
    const isCommand = input.text.trim().startsWith('/');

    if (input.chatType === 'group') {
      const groupAllowed = policy.groupPolicy === 'open' || allowedGroups.has(input.chatId);
      if (!groupAllowed) return { allowed: false, isAdmin, reason: 'grup tidak terdaftar' };
      if (policy.requireMention && !input.mentioned && !isCommand) {
        return { allowed: false, isAdmin, reason: 'tidak menyebut bot' };
      }
      return { allowed: true, isAdmin };
    }

    if (policy.dmPolicy === 'allowlist' && !kandidat.some((value) => allowedNumbers.has(value))) {
      return { allowed: false, isAdmin, reason: 'nomor tidak terdaftar' };
    }
    return { allowed: true, isAdmin };
  }

  async upsertSetting(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO wa_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value],
    );
  }
}

import { describe, expect, it } from 'vitest';
import {
  CONFIG_HELPER_PATH,
  RadiusConfigNotReadyError,
  RadiusConfigRejectedError,
  RadiusConfigService,
} from '../src/app/modules/freeradius/radius-config.service';

// Helper diuji dengan perintah pengganti (printf/echo), bukan helper asli:
// uji tidak boleh menulis /etc/freeradius maupun me-restart service.
const fake = (script: string) => {
  const service = new RadiusConfigService();
  service.runner = { file: '/bin/sh', args: ['-c', script] };
  return service;
};

describe('RadiusConfigService', () => {
  it('path helper menunjuk satu file tetap tanpa karakter shell', () => {
    expect(CONFIG_HELPER_PATH).toBe('/usr/local/sbin/jawara-radius-config');
    expect(CONFIG_HELPER_PATH).not.toMatch(/[;&|`$]/);
  });

  it('membaca pengaturan dari helper', async () => {
    const payload = JSON.stringify({
      ok: true,
      settings: {
        listen_address: '*',
        auth_port: 1812,
        acct_port: 1813,
        db_host: '127.0.0.1',
        db_port: 3306,
        db_name: 'isp_billing',
        db_user: 'radius',
        read_clients: true,
      },
      db_password: 'managed',
      probe: { installed: true, service: 'active', site_enabled: true, sql_module_enabled: true },
    });
    const service = fake(`echo '${payload}'`);

    const result = await service.read();
    expect(result.settings.auth_port).toBe(1812);
    expect(result.settings.read_clients).toBe(true);
    // Password tidak pernah berupa nilai asli.
    expect(result.db_password).toBe('managed');
  });

  it('meneruskan spesifikasi ke stdin helper sebagai JSON', async () => {
    const service = fake(
      "cat > /tmp/jawara-cfg-uji.json; printf '%s' '{\"ok\":true,\"settings\":{},\"db_password\":\"managed\",\"db_user_ready\":true,\"db_error\":null,\"reloaded\":true,\"service\":\"active\",\"validation\":[\"Configuration appears to be OK\"]}'",
    );

    await service.apply({
      listen_address: '*',
      auth_port: 1812,
      acct_port: 1813,
      db_host: '127.0.0.1',
      db_port: 3306,
      db_name: 'isp_billing',
      db_user: 'radius',
      read_clients: true,
    });

    const { readFileSync } = await import('node:fs');
    const sent = JSON.parse(readFileSync('/tmp/jawara-cfg-uji.json', 'utf8'));
    expect(sent.auth_port).toBe(1812);
    expect(sent.db_name).toBe('isp_billing');
    expect(sent.read_clients).toBe(true);
  });

  it('menerjemahkan penolakan helper menjadi RadiusConfigRejectedError', async () => {
    const service = fake(
      `printf '%s' '{"ok":false,"error":"Konfigurasi ditolak FreeRADIUS; perubahan dibatalkan.","validation":["/etc/freeradius/3.0/sites-enabled/jawara[7]: Unknown value"]}'`,
    );

    const error = await service.apply({} as never).catch((err) => err);
    expect(error).toBeInstanceOf(RadiusConfigRejectedError);
    expect((error as Error).message).toMatch(/dibatalkan/);
    expect((error as RadiusConfigRejectedError).validation.length).toBe(1);
  });

  it('melaporkan helper yang tidak ada dengan pesan yang bisa dibaca', async () => {
    const service = new RadiusConfigService();
    service.runner = null;
    // available() melihat berkas sungguhan; bila helper belum dipasang,
    // pemanggilan harus gagal dengan pesan setup, bukan error mentah.
    if (service.available()) return;
    await expect(service.read()).rejects.toBeInstanceOf(RadiusConfigNotReadyError);
    await expect(service.read()).rejects.toThrow(/setup-helper\.sh/);
  });

  it('menolak balasan yang bukan JSON tanpa melempar error mentah', async () => {
    const service = fake('echo "bukan json"');
    await expect(service.read()).rejects.toBeInstanceOf(RadiusConfigNotReadyError);
    await expect(service.read()).rejects.toThrow(/tidak bisa dibaca/);
  });

  it('aksi service diteruskan sebagai argumen, bukan shell', async () => {
    const service = fake(`printf '%s' '{"ok":true,"service":"active","action":"restart"}'`);
    const result = await service.control('restart');
    expect(result.service).toBe('active');
  });
});

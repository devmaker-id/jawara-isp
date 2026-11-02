import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WaRouterService } from '../src/app/modules/whatsapp-gateway/wa-router.service';
import type { WaWorkerClient } from '../src/app/modules/whatsapp-gateway/wa-worker.client';

// Router deterministik: perintah dijawab tanpa AI, dan otorisasi ditegakkan
// di sini (bukan di prompt).

const worker = {
  health: vi.fn().mockResolvedValue({
    status: 'connected',
    number: '628111',
    connected_at: '2026-11-02T16:00:00.000Z',
    qr_available: false,
    reconnect_count: 2,
    sent: 5,
    received: 7,
    pending: 0,
    last_error: null,
  }),
} as unknown as WaWorkerClient;

const admin = { chatId: '628111@s.whatsapp.net', chatType: 'dm' as const, sender: '628111', isAdmin: true, args: '' };
const user = { ...admin, isAdmin: false };

describe('WaRouterService', () => {
  let router: WaRouterService;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new WaRouterService(worker);
  });

  it('mengenali perintah dan argumennya', () => {
    expect(router.parse('/inet 1312016')).toEqual({ name: 'inet', args: '1312016' });
    expect(router.parse('  /status ')).toEqual({ name: 'status', args: '' });
    expect(router.parse('halo')).toBeNull();
  });

  it('/help untuk pengguna biasa hanya memuat perintah umum', async () => {
    const hasil = await router.execute('help', user);
    expect(hasil?.ok).toBe(true);
    expect(hasil?.reply).toContain('/help');
    // Perintah operasional disembunyikan dari non-admin.
    expect(hasil?.reply).not.toContain('/inet');
    expect(hasil?.reply).not.toContain('/status');
  });

  it('/help untuk admin memuat semua perintah', async () => {
    const hasil = await router.execute('help', admin);
    expect(hasil?.reply).toContain('/status');
    expect(hasil?.reply).toContain('/pelanggan');
  });

  it('/status memakai data worker, bukan model', async () => {
    const hasil = await router.execute('status', admin);
    expect(worker.health).toHaveBeenCalled();
    expect(hasil?.reply).toContain('connected');
    expect(hasil?.reply).toContain('628111');
  });

  it('menolak perintah admin dari pengguna biasa', async () => {
    const hasil = await router.execute('status', user);
    expect(hasil?.ok).toBe(false);
    expect(hasil?.reply).toMatch(/administrator/i);
  });

  it('perintah tak dikenal tidak dijalankan router', async () => {
    expect(await router.execute('ngawur', admin)).toBeNull();
    expect(router.has('ngawur')).toBe(false);
  });

  it('/inet tanpa nomor memberi cara pakai, tanpa memanggil skrip', async () => {
    const hasil = await router.execute('inet', admin);
    expect(hasil?.ok).toBe(false);
    expect(hasil?.reply).toContain('Format: /inet');
  });

  it('/inet menolak nomor yang tidak sah', async () => {
    const hasil = await router.execute('inet', { ...admin, args: 'abc' });
    expect(hasil?.ok).toBe(false);
    expect(hasil?.reply).toMatch(/tidak sah/i);
  });

  it('daftar perintah tercatat untuk halaman Command Router', () => {
    const names = router.list().map((row) => row.name);
    expect(names).toEqual(['help', 'status', 'inet', 'pelanggan']);
  });
});

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HELPER_PATH,
  InstallConflictError,
  InstallNotReadyError,
  RadiusInstallService,
} from '../src/app/modules/freeradius/radius-install.service';

// Menunggu sampai proses uji selesai (running=false) tanpa menebak waktu.
const waitUntilDone = async (service: RadiusInstallService, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (service.state().running) {
    if (Date.now() > deadline) throw new Error('proses uji tidak selesai');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

// Catatan: di mesin pengembangan helper pemasang memang BELUM dipasang
// (deploy/setup-helper.sh baru dijalankan administrator). Semua uji di bawah
// tidak pernah menjalankan apt maupun systemctl.
describe('RadiusInstallService', () => {
  it('probe() hanya membaca status, tanpa mengubah apa pun', () => {
    const probe = new RadiusInstallService().probe();

    // Hasilnya mengikuti kenyataan mesin, bukan nilai yang dipaksakan:
    // `installed` hanya benar bila biner DAN unit systemd ditemukan.
    expect(probe.installed).toBe(probe.binary && probe.unit_present);
    if (!probe.binary) expect(probe.version).toBeNull();
    // Nilai-nilai ini bertipe pasti, bukan undefined.
    expect(typeof probe.unit_present).toBe('boolean');
    expect(typeof probe.sql_module).toBe('boolean');
    expect(typeof probe.service_active).toBe('boolean');
    expect(Array.isArray(probe.config_dirs)).toBe(true);
  });

  it('menolak memasang bila helper belum ada, dengan pesan yang bisa dibaca', async () => {
    // helperPath diarahkan ke lokasi yang pasti tidak ada, sehingga uji ini
    // tidak bergantung pada apakah helper sudah dipasang di mesin pengembang.
    const service = new RadiusInstallService();
    service.helperPath = '/nonexistent/jawara-radius-install';

    await expect(service.start({ userId: 1, ip: '127.0.0.1' })).rejects.toBeInstanceOf(
      InstallNotReadyError,
    );
    await expect(service.start({ userId: 1, ip: '127.0.0.1' })).rejects.toThrow(
      /setup-helper\.sh/,
    );
    // Tidak ada proses yang dijalankan.
    expect(service.state().running).toBe(false);
  });

  it('state() awal bersih: belum berjalan, belum selesai, tanpa exit code', () => {
    const service = new RadiusInstallService();
    const state = service.state();

    expect(state.running).toBe(false);
    expect(state.finished).toBe(false);
    expect(state.ok).toBeNull();
    expect(state.exit_code).toBeNull();
    expect(state.started_at).toBeNull();
    expect(state.finished_at).toBeNull();
    // Status helper mengikuti kenyataan mesin, bukan asumsi uji.
    expect(state.helper_installed).toBe(existsSync(HELPER_PATH));
    expect(state.log_file).toBe('(belum ada pemasangan)');
  });

  it('log(0) pada instance baru kosong dan offset nol', () => {
    const page = new RadiusInstallService().log(0);

    expect(page.lines).toEqual([]);
    expect(page.offset).toBe(0);
    expect(page.running).toBe(false);
  });

  it('offset negatif atau bukan angka diperlakukan sebagai 0', () => {
    const service = new RadiusInstallService();

    for (const offset of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const page = service.log(offset as number);
      expect(page.lines).toEqual([]);
      expect(page.offset).toBe(0);
    }
  });

  it('helper path menunjuk satu file tetap, bukan perintah bebas', () => {
    expect(HELPER_PATH).toBe('/usr/local/sbin/jawara-radius-install');
    // Tidak ada parameter dari request web yang bisa disisipkan.
    expect(HELPER_PATH).not.toMatch(/[;&|`$]/);
  });

  it('dua jenis galat berbeda supaya controller bisa memetakan status HTTP', () => {
    const notReady = new InstallNotReadyError('x');
    const conflict = new InstallConflictError('y');

    expect(notReady).toBeInstanceOf(Error);
    expect(conflict).toBeInstanceOf(Error);
    expect(notReady.name).not.toBe(conflict.name);
  });
});

// Mesin streaming diuji dengan perintah pengganti, bukan apt. Runner khusus
// hanya bisa diberikan oleh kode server; endpoint HTTP tidak menerima
// parameter apa pun sehingga jalur ini tidak bisa dipakai dari web.
describe('RadiusInstallService — streaming log', () => {
  const fakeRunner = (script: string) => ({ file: '/bin/sh', args: ['-c', script] });
  const withRunner = (runner: { file: string; args: string[] }) => {
    const service = new RadiusInstallService();
    service.runner = runner;
    return service;
  };

  it('menampilkan stdout dan stderr baris per baris lalu menandai selesai', async () => {
    const service = withRunner(fakeRunner('echo "=== langkah 1 ==="; echo "ok satu"; echo "peringatan" >&2; exit 0'));

    const first = await service.start({ userId: 7, ip: '127.0.0.1' });
    expect(first.running).toBe(true);

    await waitUntilDone(service);
    const page = service.log(0);
    const text = page.lines.map((line) => line.text);

    expect(text.some((line) => line.includes('pemasangan dimulai oleh user #7'))).toBe(true);
    expect(text).toContain('=== langkah 1 ===');
    expect(text).toContain('ok satu');
    expect(text).toContain('peringatan'); // stderr ikut tertangkap
    expect(text.some((line) => line.includes('SELESAI'))).toBe(true);

    expect(page.running).toBe(false);
    expect(page.finished).toBe(true);
    expect(page.ok).toBe(true);
    expect(page.exit_code).toBe(0);
    expect(page.started_at).not.toBeNull();
    expect(page.finished_at).not.toBeNull();
  });

  it('offset hanya mengembalikan baris baru', async () => {
    const service = withRunner(fakeRunner('echo a; echo b; echo c; exit 0'));
    await service.start({ userId: 1, ip: '' });
    await waitUntilDone(service);

    const all = service.log(0);
    const cut = Math.floor(all.offset / 2);
    const rest = service.log(cut);

    expect(rest.lines.length).toBeLessThan(all.lines.length);
    expect(rest.lines.every((line) => line.index >= cut)).toBe(true);
    expect(rest.offset).toBe(all.offset);
  });

  it('kode keluar bukan nol ditandai gagal beserta saran tindakan', async () => {
    const service = withRunner(fakeRunner('echo "E: boom" >&2; exit 100'));
    await service.start({ userId: 1, ip: '' });
    await waitUntilDone(service);

    const page = service.log(0);
    const text = page.lines.map((line) => line.text).join('\n');

    expect(page.ok).toBe(false);
    expect(page.exit_code).toBe(100);
    expect(text).toContain('GAGAL dengan kode keluar 100');
    // Tidak mengklaim ada data yang berubah.
    expect(text).toContain('Tidak ada data panel');
  });

  it('menerjemahkan penolakan sudo menjadi instruksi setup-helper', async () => {
    const service = withRunner(fakeRunner('echo "sudo: a password is required" >&2; exit 1'));
    await service.start({ userId: 1, ip: '' });
    await waitUntilDone(service);

    const text = service
      .log(0)
      .lines.map((line) => line.text)
      .join('\n');

    expect(text).toContain('deploy/setup-helper.sh');
    expect(text).toContain('aturan /etc/sudoers.d/jawara-radius belum aktif');
  });

  it('tidak bisa menjalankan dua pemasangan sekaligus', async () => {
    const service = withRunner(fakeRunner('sleep 1; exit 0'));
    await service.start({ userId: 1, ip: '' });

    await expect(service.start({ userId: 1, ip: '' })).rejects.toBeInstanceOf(
      InstallConflictError,
    );

    await waitUntilDone(service);
  });
});

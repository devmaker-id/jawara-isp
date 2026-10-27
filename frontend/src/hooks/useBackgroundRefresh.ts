import { useEffect, useRef } from 'react';

/**
 * Memuat ulang data di belakang layar.
 *
 * Halaman dipanggil ulang saat tab kembali aktif (fokus / visibilitychange)
 * dan, bila `intervalMs` diisi, secara berkala. Tidak ada reload halaman:
 * data lama tetap tampil sampai data baru tiba.
 *
 * Pengaman:
 *   - hanya berjalan saat tab terlihat, jadi tab latar tidak menghajar server
 *   - minimal 5 detik antar-pemuatan, supaya fokus/interval tidak menumpuk
 *   - satu pemuatan berbarengan saja; pemanggilan saat masih berjalan dilewati
 */
export function useBackgroundRefresh(
  refresh: () => void | Promise<unknown>,
  options: { intervalMs?: number; minGapMs?: number } = {},
): void {
  const latest = useRef(refresh);
  latest.current = refresh;

  const running = useRef(false);
  const lastRun = useRef(0);

  const { intervalMs = 60_000, minGapMs = 5_000 } = options;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (running.current) return;
      if (Date.now() - lastRun.current < minGapMs) return;

      lastRun.current = Date.now();
      running.current = true;
      Promise.resolve(latest.current())
        .catch(() => {
          // Halaman sudah menampilkan galatnya sendiri; di sini cukup diam
          // supaya pemuatan latar tidak memunculkan pesan palsu.
        })
        .finally(() => {
          running.current = false;
        });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };

    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    const timer = intervalMs > 0 ? window.setInterval(tick, intervalMs) : null;

    return () => {
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [intervalMs, minGapMs]);
}

export default useBackgroundRefresh;

import { defineConfig } from 'vitest/config';

// Tes integrasi menulis ke database, jadi HANYA berjalan pada instance
// sekali-pakai. Guard di test/reseller-isolation.int-spec.ts menolak jalan bila
// DB_NAME menunjuk produksi. Konfigurasi terpisah agar `npx vitest run` (unit)
// dan `vitest.config.e2e.ts` tidak pernah memungut tes ini.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

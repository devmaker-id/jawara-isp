import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Produksi memakai hasil build (bukan dev server): `vite build` lalu
// `vite preview` di port 3000. Proxy /api tetap sama supaya aplikasi tidak
// perlu tahu alamat backend. `dev:hmr` menjalankan dev server untuk bekerja
// lokal.
const apiProxy = {
    '/api': {
        target: 'http://localhost:7930',
        changeOrigin: true,
    },
};

export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 3000,
        allowedHosts: ['billing-bibit.devtun.my.id'],
        proxy: apiProxy,
    },
    preview: {
        host: '0.0.0.0',
        port: 3000,
        strictPort: true,
        allowedHosts: ['billing-bibit.devtun.my.id'],
        proxy: apiProxy,
    },
    resolve: {
        alias: {
            '@': '/src',
        },
    },
});

import axios from 'axios';

// Base URL API menggunakan path RELATIF ("/").
// Alasan:
//   - Di dev, Vite dev-server proxy ("/api" -> http://localhost:7930) meneruskan
//     permintaan. Jika baseURL menggunakan URL absolut ("http://localhost:7930/api")
//     + endpoint "/api/auth/login", maka URL jadi "/api/api/auth/login" (404) ->
//     login ditolak (masalah pertama). Gunakan path relatif agar proxy menangkap.
//   - Di produksi, jika frontend dijadikan same-origin dengan backend, "/api"
//     langsung diteruskan ke backend.
const API_BASE = '/';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - attach auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Klasifikasi kegagalan sesi. Hanya 401 yang berarti "kredensial tidak sah".
// 403 = terautentikasi tapi tidak berhak; sesi tetap sah, token TIDAK dihapus.
// 5xx/503/timeout/offline = masalah server atau jaringan; sesi dipertahankan
// agar pengguna tidak ter-logout karena gangguan sementara.
export type SessionFailureKind = 'unauthenticated' | 'forbidden' | 'server' | 'network' | 'other';

export function classifySessionFailure(error: unknown): SessionFailureKind {
  const status = (error as { response?: { status?: number } })?.response?.status;

  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (typeof status === 'number' && status >= 500) return 'server';
  // Tanpa status: request tidak pernah sampai (offline, timeout, DNS).
  if (status === undefined) return 'network';
  return 'other';
}

// Sesi berakhir. Disiarkan sebagai peristiwa, BUKAN dengan memuat ulang
// halaman: AuthContext mengosongkan sesi dan router mengarahkan ke /login
// tanpa memuat ulang seluruh panel.
export const AUTH_EXPIRED_EVENT = 'auth:expired';

export function broadcastAuthExpired(): void {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

// Response interceptor - hanya menangani sesi yang benar-benar tidak sah
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (classifySessionFailure(error) === 'unauthenticated') {
      const isLoginAttempt = error.config?.url?.includes('/auth/login');
      if (!isLoginAttempt) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (window.location.pathname !== '/login') {
          broadcastAuthExpired();
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;

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

// Response interceptor - handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isLoginAttempt = error.config?.url?.includes('/auth/login');
      if (!isLoginAttempt) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;

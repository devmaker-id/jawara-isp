export interface MenuItemConfig {
  path: string;
  label: string;
  icon: string;
  available: boolean;
}

// Sumber konfigurasi menu tunggal. Tambahkan item baru di sini; ekstensi
// fitur baru hanya cukup mengubah daftar ini (dan menambahkan route sedemikian
// rupa saat item ini siap dipakai).
export const menuItems: MenuItemConfig[] = [
  { path: '/', label: 'Dashboard', icon: 'M3 12l9-9 9 9M5 10v10h14V10', available: true },
  { path: '/customers', label: 'Pelanggan', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', available: true },
  { path: '/packages', label: 'Paket Internet', icon: 'M4 5h16v14H4z M4 9h16 M4 15h16 M8 9v6', available: true },
  { path: '/layanan', label: 'Layanan', icon: 'M12 10v6m0 0l-3-3m3 3l3-3M5 21h14', available: false },
  { path: '/invoices', label: 'Tagihan', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', available: true },
  { path: '/pembayaran', label: 'Pembayaran', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293a1 1 0 001.414 1.414L11 13H19m-3 0H5m3 0h2m-2 4h2m-2 4h2', available: false },
  { path: '/freeradius', label: 'FreeRADIUS', icon: 'M5 12h14M5 12a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V12z', available: false },
  { path: '/mikrotik', label: 'MikroTik', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m2 12a2 2 0 01-2 2H7a2 2 0 01-2-2v-8m2 12h10a2 2 0 002-2v-8a2 2 0 00-2-2h-3', available: false },
  { path: '/laporan', label: 'Laporan', icon: 'M9 17v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2zM19 21V5a2 2 0 00-2-2h-6a2 2 0 00-2 2v16m2 12a2 2 0 01-2 2H7a2 2 0 01-2-2v-8m2 12h10a2 2 0 002-2v-8a2 2 0 00-2-2h-3', available: false },
  { path: '/pengguna', label: 'Pengguna', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', available: false },
  { path: '/settings', label: 'Pengaturan', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0M15.02 10.919c.387-1.636 2.401-1.636 2.788 0M16.182 18.05c-.457 1.14-2.67 1.14-3.127 0M9.437 3.058c.426-1.756 2.924-1.756 3.35 0M15.02 10.919c.387-1.636 2.401-1.636 2.788 0M16.182 18.05c-.457 1.14-2.67 1.14-3.127 0', available: true },
  { path: '/profile', label: 'Profil', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', available: true },
];

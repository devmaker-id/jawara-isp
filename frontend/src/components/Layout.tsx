import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { menuItems, MenuItemConfig } from '../config/menu';

const MenuIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const MenuItem: React.FC<{ item: MenuItemConfig; onNavigate: () => void }> = ({ item, onNavigate }) => {
  const location = useLocation();

  if (!item.available) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 cursor-not-allowed select-none">
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
        </svg>
        <span className="truncate">{item.label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600">Belum tersedia</span>
      </div>
    );
  }

  const active = location.pathname === item.path;
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${active
        ? 'bg-cyan-500/10 text-cyan-400'
        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
      }`}
    >
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
      </svg>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
};

// Grup menu dengan sub-menu. Induk hanya membuka/menutup daftar anak, atau
// berpindah ke halaman ringkasan bila judul induk diklik dua kali dari grup
// yang sudah terbuka. Status buka mengikuti halaman aktif agar pengguna
// selalu melihat di mana posisinya setelah refresh.
const MenuGroup: React.FC<{ item: MenuItemConfig; onNavigate: () => void }> = ({ item, onNavigate }) => {
  const location = useLocation();
  const children = item.children ?? [];
  const isChildActive = children.some((child) => child.path === location.pathname);
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive, location.pathname]);

  if (!item.available) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 cursor-not-allowed select-none">
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
        </svg>
        <span className="truncate">{item.label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600">Belum tersedia</span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          isChildActive
            ? 'bg-cyan-500/10 text-cyan-400'
            : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
        }`}
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
        </svg>
        <span className="truncate">{item.label}</span>
        <svg
          className={`ml-auto w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && (
        <div className="mt-1 space-y-0.5 border-l border-slate-700/60 pl-3 ml-5">
          {children.map((child) => {
            const active = location.pathname === child.path;
            return (
              <NavLink
                key={child.path}
                to={child.path}
                end
                onClick={onNavigate}
                className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-cyan-500/10 text-cyan-300 font-medium'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                }`}
              >
                <span className="truncate">{child.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Layout route React Router v6: child route dirender lewat <Outlet />,
// bukan lewat prop `children` (prop itu tidak pernah dikirim router).
const Layout: React.FC = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();

  // Filter kosmetik berbasis role. Penegakan akses tetap di RolesGuard backend.
  const visibleMenu = menuItems.filter(
    (item) => !item.roles || (user?.role && item.roles.includes(user.role as never)),
  );

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    // h-screen + min-h-0 pada baris konten: header & sidebar tetap diam,
    // hanya panel konten yang scroll. Tanpa ini sidebar ikut tergulir.
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100 overflow-hidden">
      {/* Header kiri, hamburger resmi kiri atas (hanya mobile) */}
      <header className="flex h-16 shrink-0 items-center justify-between px-4 border-b border-slate-700/50 bg-slate-900/90 md:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen(!open)}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition md:hidden"
            aria-label={open ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={open}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-cyan-500 flex items-center justify-center text-white">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold leading-tight text-white">jawara-billing</p>
              <p className="text-xs text-slate-500 leading-tight">BibitNet ISP</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {user && (
            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-700/50">
              <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-medium text-slate-200">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-slate-300 hidden md:inline">{user.name}</span>
              <span className="text-xs text-slate-400 hidden sm:inline">{user.role}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main content area: sidebar and page content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar kiri: desktop selalu tampil, mobile drawer dari kiri */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex flex-col flex-shrink-0 border-r border-slate-700/50 bg-slate-800 text-slate-100 transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full'} md:static md:inset-auto md:left-auto md:z-auto md:translate-x-0`}
          style={{ width: 'var(--drawer-width)', maxWidth: 'var(--drawer-max-width)' }}
          aria-label="Sidebar navigasi"
        >
          {/* flex-1 + min-h-0: wajib, agar nav di dalamnya benar-benar scroll
              dan bukan mendorong footer keluar layar. */}
          <div className="flex flex-1 min-h-0 flex-col">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700/50">
              <div className="flex items-center gap-2">
                {user && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-medium text-slate-200">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm text-slate-300 hidden md:inline">{user.name}</span>
                    <span className="text-xs text-slate-400 hidden sm:inline">{user.role}</span>
                  </div>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition md:hidden"
                  aria-label="Tutup menu"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            {/* Drawer nav */}
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {visibleMenu.map((item) =>
                item.children && item.children.length > 0 ? (
                  <MenuGroup key={item.path} item={item} onNavigate={() => setOpen(false)} />
                ) : (
                  <MenuItem key={item.path} item={item} onNavigate={() => setOpen(false)} />
                ),
              )}
            </nav>

            {/* Drawer footer */}
            <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-700/50">
              <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-sm font-medium text-slate-200">
                {user?.name?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
                <p className="text-xs text-slate-500 truncate">{user?.role}</p>
              </div>
              <button
                onClick={() => {
                  logout();
                  setOpen(false);
                }}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition"
                title="Logout"
                aria-label="Logout"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Konten utama: menggunakan layout bersama, tanpa margin kiri */}
        <div className="page-container flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>

      {/* Backdrop mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default Layout;

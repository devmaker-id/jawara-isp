import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import { menuItems, MenuItemConfig } from '../config/menu';
import UsageLookupDialog from './net/UsageLookupDialog';

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

/**
 * Identitas panel: logo + nama + tagline, semuanya dari Pengaturan → Branding.
 * Dipakai di navbar dan di kepala drawer mobile, supaya tidak ada teks yang
 * ditulis ulang di dua tempat.
 */
const BrandMark: React.FC<{ onClick?: () => void; compact?: boolean }> = ({
  onClick,
  compact = false,
}) => {
  const brand = useBranding();

  return (
    <Link
      to="/"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg transition hover:opacity-90"
      aria-label={`${brand.name} — ke dashboard`}
    >
      {/* Logo dari pengaturan; bila gagal dimuat, kotak warna utama dengan
          inisial menjadi cadangan supaya ruangnya tidak kosong. */}
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-bold text-white"
        style={{ backgroundColor: 'var(--brand-primary)' }}
      >
        <img
          src={brand.logo_url}
          alt=""
          className="h-full w-full object-contain"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
        {!brand.logo_url && (brand.name.charAt(0) || 'J').toUpperCase()}
      </span>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight text-white">{brand.name}</p>
          {brand.tagline && (
            <p className="truncate text-[11px] leading-tight text-slate-400">{brand.tagline}</p>
          )}
        </div>
      )}
    </Link>
  );
};

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

// Grup menu dengan sub-menu. Status buka dititipkan ke Layout supaya berlaku
// seperti accordion: membuka satu grup menutup grup lain. Induk hanya
// membuka/menutup daftar anak, atau berpindah ke halaman ringkasan bila judul
// induk diklik dua kali dari grup yang sudah terbuka.
// Cocokkan path anak menu. Anak boleh memakai query string (mis.
// /settings?tab=payment); tanpa query, halaman dianggap memakai pilihan
// pertama penyedianya — untuk /settings itu "branding".
const matchesMenuPath = (
  path: string,
  location: { pathname: string; search: string },
): boolean => {
  if (!path.includes('?')) return location.pathname === path;
  const [base, query] = path.split('?');
  if (location.pathname !== base) return false;
  const search =
    location.search.replace(/^\?/, '') || (base === '/settings' ? 'tab=branding' : '');
  return search === query;
};

const MenuGroup: React.FC<{
  item: MenuItemConfig;
  onNavigate: () => void;
  open: boolean;
  onToggle: () => void;
}> = ({ item, onNavigate, open, onToggle }) => {
  const location = useLocation();
  const children = item.children ?? [];

  const isChildActive = children.some((child) => matchesMenuPath(child.path, location));

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
        onClick={onToggle}
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

      {/* Baris 0fr -> 1fr: tinggi sub-menu dianimasikan, jadi tutup/buka
          terasa halus, bukan melompat. */}
      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden" aria-hidden={!open}>
          <div className="mt-1 space-y-0.5 border-l border-slate-700/60 pl-3 ml-5">
            {children.map((child) => {
              const active = matchesMenuPath(child.path, location);
              return (
                <NavLink
                  key={child.path}
                  to={child.path}
                  end
                  onClick={onNavigate}
                  tabIndex={open ? 0 : -1}
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
        </div>
      </div>
    </div>
  );
};

// Layout route React Router v6: child route dirender lewat <Outlet />,
// bukan lewat prop `children` (prop itu tidak pernah dikirim router).
const Layout: React.FC = () => {
  const [open, setOpen] = useState(false);
  // Menu akun di navbar kanan: Lihat profil / Logout.
  const [accountOpen, setAccountOpen] = useState(false);
  // Accordion sidebar: hanya satu grup menu yang boleh terbuka.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Dialog "Cek pemakaian user" — dipakai semua role, dari halaman mana pun.
  const [usageOpen, setUsageOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { user, logout } = useAuth();
  const brand = useBranding();

  // Filter kosmetik berbasis role. Penegakan akses tetap di RolesGuard backend.
  const visibleMenu = menuItems.filter(
    (item) => !item.roles || (user?.role && item.roles.includes(user.role as never)),
  );

  // Grup yang memuat halaman aktif; grup inilah yang otomatis terbuka.
  const activeGroup =
    visibleMenu.find((item) =>
      item.children?.some((child) => matchesMenuPath(child.path, location)),
    )?.path ?? null;

  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  // Klik di luar menu akun menutup dropdown.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setAccountOpen(false);
      }
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
            <div className="sm:hidden">
              <BrandMark compact />
            </div>
            <div className="hidden sm:block">
              <BrandMark />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setUsageOpen(true)}
            title="Cek pemakaian user"
            aria-label="Cek pemakaian user"
            className="flex items-center gap-2 rounded-lg border border-slate-700/60 px-2.5 py-2 text-sm text-slate-300 transition hover:border-slate-600 hover:bg-slate-700/40 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
            </svg>
            <span className="hidden lg:inline">Cek pemakaian</span>
          </button>
          {user && (
            <div className="relative" ref={accountRef}>
              <button
                type="button"
                onClick={() => setAccountOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                className="flex items-center gap-2.5 rounded-lg border-l border-slate-700/50 py-1.5 pl-3 pr-2 transition hover:bg-slate-700/40"
              >
                <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-medium text-slate-200">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-slate-300 hidden md:inline">{user.name}</span>
                <span className="text-xs text-slate-400 hidden sm:inline">{user.role}</span>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform ${accountOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {accountOpen && (
                <div
                  role="menu"
                  aria-label="Menu akun"
                  className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
                >
                  <Link
                    to="/profile"
                    role="menuitem"
                    onClick={() => setAccountOpen(false)}
                    className="block px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700/60"
                  >
                    Lihat profil
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      void logout();
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-rose-300 transition hover:bg-slate-700/60"
                  >
                    Logout
                  </button>
                </div>
              )}
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
            {/* Drawer header: identitas panel + tombol tutup (mobile). Akun dan logout
                ada di navbar kanan. */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-700/50 px-4 py-3 md:hidden">
              <BrandMark onClick={() => setOpen(false)} />
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-white"
                aria-label="Tutup menu"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Drawer nav */}
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {visibleMenu.map((item) =>
                item.children && item.children.length > 0 ? (
                  <MenuGroup
                    key={item.path}
                    item={item}
                    onNavigate={() => setOpen(false)}
                    open={openGroup === item.path}
                    onToggle={() =>
                      setOpenGroup((previous) => (previous === item.path ? null : item.path))
                    }
                  />
                ) : (
                  <MenuItem key={item.path} item={item} onNavigate={() => setOpen(false)} />
                ),
              )}
            </nav>
          </div>
        </aside>

        {/* Konten utama: diberi jarak 5 px dari garis navbar. */}
        <div className="page-container flex-1 overflow-y-auto pt-[5px]">
          <Outlet />

          {/* Footer: kredit pembuat panel. Ikut tergulung bersama konten, jadi
              tidak pernah menutupi tabel panjang di layar kecil. */}
          <footer className="mt-8 border-t border-slate-700/50 py-4 text-center text-[11px] text-slate-500">
            {/* Teks footer dari Pengaturan → Branding (mis. "© 2026 BibitNet").
                Kosong berarti baris ini tidak tampil sama sekali. */}
            {brand.footer_text && (
              <p className="mb-1 text-slate-400">{brand.footer_text}</p>
            )}
            Created by{' '}
            <a
              href="https://github.com/devmaker-id/jawara-isp"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-400 transition hover:text-[var(--brand-primary)]"
            >
              JAWARA-ISP
            </a>
            <span className="mx-1.5 text-slate-600">·</span>
            <a
              href="https://github.com/devmaker-id"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[var(--brand-primary)]"
            >
              devmaker
            </a>
            <span className="mx-1.5 text-slate-600">·</span>
            {new Date().getFullYear()}
          </footer>
        </div>
      </div>

      {/* Dialog pencarian pemakaian: satu komponen untuk semua halaman. */}
      <UsageLookupDialog open={usageOpen} onClose={() => setUsageOpen(false)} />

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

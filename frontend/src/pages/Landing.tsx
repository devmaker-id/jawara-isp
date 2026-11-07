import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import { useTheme } from '../hooks/useTheme';

/**
 * Halaman referensi (bukan beranda komersial) yang tampil sebelum login.
 *
 * Tidak memuat harga, tidak memuat tombol pendaftaran. Tujuannya menjelaskan
 * kenapa proyek dibangun dan teknologi yang dipakai, dengan satu tombol
 * "Masuk" terpisah menuju /login. Sepenuhnya mengikuti tema siang/malam
 * (kelas slate dibalik lewat CSS variable, sama seperti panel).
 */

const FullScreenSpinner: React.FC = () => (
  <div className="flex h-screen items-center justify-center bg-slate-900">
    <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-cyan-400" />
  </div>
);

const SunIcon: React.FC = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="4" strokeWidth={2} />
    <path
      strokeLinecap="round"
      strokeWidth={2}
      d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
    />
  </svg>
);

const MoonIcon: React.FC = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
    />
  </svg>
);

interface Tech {
  name: string;
  detail: string;
}

const TECHNOLOGIES: Tech[] = [
  { name: 'NestJS', detail: 'Backend Node.js + TypeScript: REST API, guard JWT, validasi per modul.' },
  { name: 'React + Vite', detail: 'Frontend SPA TypeScript + Tailwind CSS, build dan preview via Vite.' },
  { name: 'MariaDB', detail: 'Penyimpanan pelanggan, voucher, tagihan, plus tabel RADIUS (radcheck/radacct).' },
  { name: 'FreeRADIUS', detail: 'Otentikasi PPPoE/hotspot (rlm_sql) — sumber kebenaran status, masa aktif, dan kuota.' },
  { name: 'MikroTik RouterOS', detail: 'Baca status interface/hotspot/PPP via RouterOS API (TCP), mode tulis per perangkat.' },
  { name: 'OLT GPON/EPON', detail: 'VSOL/Global (SSH) dan HiFocus/HiOs (telnet): inventori ONU, redaman, kolektor syslog UDP/514.' },
  { name: 'WhatsApp Gateway', detail: 'Worker Baileys terpisah — alert ONU offline dan perintah seperti /onu_offline.' },
  { name: 'Deploy & Infra', detail: 'Unit systemd (backend/frontend) dan Cloudflare Tunnel untuk akses HTTPS.' },
];

interface Reason {
  title: string;
  text: string;
}

const REASONS: Reason[] = [
  {
    title: 'FreeRADIUS sebagai sumber kebenaran',
    text: 'Bukan MikroTik. Akun, status, masa aktif, dan kuota disimpan di RADIUS sehingga konsisten, bisa diisolir dan diaktifkan otomatis tanpa bergantung kondisi router.',
  },
  {
    title: 'Automasi operasional',
    text: 'Voucher aktif otomatis saat login pertama; isolir otomatis saat masa aktif atau kuota habis — operator tidak perlu menangani satu per satu.',
  },
  {
    title: 'Satu panel untuk semua kebutuhan',
    text: 'Pelanggan, pembayaran, voucher, keuangan harian, perangkat jaringan (MikroTik dan OLT), sampai WhatsApp gateway terkumpul dalam satu antarmuka.',
  },
  {
    title: 'Monitoring jaringan yang nyata',
    text: 'Kolektor syslog mendeteksi ONU offline beserta sebabnya (fiber putus, listrik padam, gagal autentikasi) dan mengirim alert otomatis ke grup WhatsApp.',
  },
];

const Landing: React.FC = () => {
  const { user, loading } = useAuth();
  const brand = useBranding();
  const { isDark, toggle } = useTheme();

  if (loading) return <FullScreenSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* ===== Nav ===== */}
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src={brand.logo_url}
            alt=""
            className="h-10 w-10 shrink-0 rounded-xl object-contain ring-1 ring-slate-700/60"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-base font-bold text-white">{brand.name}</p>
            {brand.tagline && <p className="truncate text-xs text-slate-400">{brand.tagline}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            title={isDark ? 'Mode siang' : 'Mode malam'}
            aria-label={isDark ? 'Aktifkan mode siang' : 'Aktifkan mode malam'}
            className="rounded-lg border border-slate-700/60 p-2 text-slate-300 transition hover:border-slate-600 hover:bg-slate-700/40 hover:text-white"
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link
            to="/login"
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
          >
            Masuk
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-8">
        {/* ===== Hero ===== */}
        <section className="pt-12 pb-14 text-center sm:pt-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
            Referensi projek · bukan produk berbayar
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
            Panel billing ISP berbasis <span className="text-cyan-300">FreeRADIUS</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-400">
            Antarmuka operasional untuk pelanggan PPPoE &amp; hotspot, voucher, penagihan,
            pemantauan MikroTik/OLT, dan notifikasi WhatsApp. Halaman ini dibuat sebagai
            referensi teknis — bukan untuk menjual layanan, tanpa harga dan tanpa pendaftaran.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="rounded-lg bg-cyan-500 px-6 py-3 font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
            >
              Masuk ke Panel
            </Link>
            <a
              href="#teknologi"
              className="rounded-lg border border-slate-700/60 px-6 py-3 font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white"
            >
              Lihat teknologi
            </a>
          </div>
        </section>

        {/* ===== Mengapa dibangun ===== */}
        <section id="mengapa">
          <h2 className="text-2xl font-bold text-white">Kenapa proyek ini dibangun</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Menjalankan ISP butuh satu sumber data yang tepercaya dan proses yang otomatis,
            bukan pencatatan tersebar di banyak router.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {REASONS.map((reason) => (
              <div
                key={reason.title}
                className="rounded-xl border border-slate-700/60 bg-slate-800 p-5"
              >
                <div className="mb-2 h-1 w-10 rounded bg-gradient-to-r from-cyan-500 to-emerald-400" />
                <h3 className="text-base font-semibold text-white">{reason.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{reason.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== Teknologi ===== */}
        <section id="teknologi" className="pt-14 sm:pt-16">
          <h2 className="text-2xl font-bold text-white">Teknologi yang digunakan</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Tiap lapisan memakai alat yang spesifik satu tugas — tanpa lapisan yang mubazir.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TECHNOLOGIES.map((tech) => (
              <div
                key={tech.name}
                className="rounded-lg border border-slate-700/60 bg-slate-800 p-4 transition hover:border-cyan-500/40"
              >
                <p className="font-semibold text-cyan-300">{tech.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{tech.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== Footer ===== */}
        <footer className="mt-14 border-t border-slate-700/50 pt-8 text-center text-sm text-slate-400 sm:mt-16">
          <p className="font-semibold text-white">{brand.name}</p>
          {brand.tagline && <p className="mt-0.5 text-xs text-slate-500">{brand.tagline}</p>}
          <p className="mt-4 text-xs text-slate-500">
            Dibuat oleh{' '}
            <a
              href="https://github.com/devmaker-id"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-400 transition hover:text-cyan-300"
            >
              devmaker
            </a>
            {' · '}
            <a
              href="https://github.com/devmaker-id/jawara-isp"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-400 transition hover:text-cyan-300"
            >
              Sumber kode
            </a>
            {' · '}
            <Link to="/login" className="transition hover:text-cyan-300">
              Masuk
            </Link>
            {' · '}
            {new Date().getFullYear()}
          </p>
        </footer>
      </main>
    </div>
  );
};

export default Landing;
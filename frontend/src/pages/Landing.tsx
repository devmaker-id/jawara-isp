import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';

/**
 * Halaman referensi (bukan beranda komersial) yang tampil sebelum login.
 *
 * Tidak memuat harga, tidak memuat tombol pendaftaran. Tujuannya menjelaskan
 * kenapa proyek dibangun dan teknologi yang dipakai, dengan satu tombol
 * "Masuk" terpisah menuju /login.
 */

const FullScreenSpinner: React.FC = () => (
  <div className="flex h-screen items-center justify-center bg-[#05080c]">
    <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-cyan-400" />
  </div>
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

  if (loading) return <FullScreenSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05080c] text-slate-100">
      {/* ===== Latar belakang (senada halaman login) ===== */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at top left, rgba(34,211,238,0.14), transparent 55%), radial-gradient(ellipse at bottom right, rgba(16,185,129,0.10), transparent 60%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
        {/* ===== Nav ===== */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src={brand.logo_url}
              alt=""
              className="h-10 w-10 rounded-xl object-contain ring-1 ring-white/15"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="leading-tight">
              <p className="text-base font-bold text-white">{brand.name}</p>
              {brand.tagline && <p className="text-xs text-slate-400">{brand.tagline}</p>}
            </div>
          </div>
          {/* Tombol login terpisah — satu-satunya aksi akun di halaman ini. */}
          <Link
            to="/login"
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400"
          >
            Masuk
          </Link>
        </header>

        {/* ===== Hero ===== */}
        <section className="pt-16 pb-14 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-300">
            Referensi projek · bukan produk berbayar
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl">
            Panel billing ISP berbasis{' '}
            <span className="text-cyan-300">FreeRADIUS</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300">
            Antarmuka operasional untuk pelanggan PPPoE &amp; hotspot, voucher, penagihan,
            pemantauan MikroTik/OLT, dan notifikasi WhatsApp. Halaman ini dibuat sebagai
            referensi teknis — bukan untuk menjual layanan, tanpa harga dan tanpa pendaftaran.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="rounded-lg bg-cyan-500 px-6 py-3 font-semibold text-white shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400"
            >
              Masuk ke Panel
            </Link>
            <a
              href="#teknologi"
              className="rounded-lg border border-slate-600/60 px-6 py-3 font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800/60 hover:text-white"
            >
              Lihat teknologi
            </a>
          </div>
        </section>

        {/* ===== Mengapa dibangun ===== */}
        <section id="mengapa" className="pt-8">
          <h2 className="text-2xl font-bold text-white">Kenapa proyek ini dibangun</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Menjalankan ISP butuh satu sumber data yang tepercaya dan proses yang otomatis,
            bukan pencatatan tersebar di banyak router.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {REASONS.map((reason) => (
              <div
                key={reason.title}
                className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 backdrop-blur-sm"
              >
                <div className="mb-2 h-1 w-10 rounded bg-gradient-to-r from-cyan-500 to-emerald-400" />
                <h3 className="text-base font-semibold text-white">{reason.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{reason.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== Teknologi ===== */}
        <section id="teknologi" className="pt-16">
          <h2 className="text-2xl font-bold text-white">Teknologi yang digunakan</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Tiap lapisan memakai alat yang spesifik satu tugas — tanpa lapisan yang mubazir.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TECHNOLOGIES.map((tech) => (
              <div
                key={tech.name}
                className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4 transition hover:border-cyan-400/30 hover:bg-slate-900/70"
              >
                <p className="font-semibold text-cyan-300">{tech.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{tech.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== Footer ===== */}
        <footer className="mt-16 border-t border-slate-700/50 py-8 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-300">{brand.name}</p>
          {brand.tagline && <p className="mt-0.5 text-xs text-slate-500">{brand.tagline}</p>}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs">
            <Link to="/login" className="font-medium text-slate-300 transition hover:text-cyan-300">
              Masuk
            </Link>
            <span className="text-slate-600">·</span>
            <a
              href="https://github.com/devmaker-id/jawara-isp"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-cyan-300"
            >
              Sumber kode
            </a>
            <span className="text-slate-600">·</span>
            <span>{new Date().getFullYear()}</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Landing;
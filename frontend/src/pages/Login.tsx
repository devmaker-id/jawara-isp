import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';

// Nuansa "linux networking" untuk latar: log terminal generik.
// Tanpa hostname asli, IP internal, nama VLAN/interfac, atau konfigurasi
// produksi apa pun (semua placeholder agar tidak membocorkan footprint).
const NET_LOGS: string[] = [
  'root@jawara-isp:~# hostname',
  'jawara-isp',
  'root@jawara-isp:~# ip link show',
  '1: lo:    <LOOPBACK,UP,LOWER_UP>',
  '2: eth0:  <BROADCAST,MULTICAST,UP,LOWER_UP>',
  'root@jawara-isp:~# ping -c 1 gateway',
  '64 bytes from gateway: icmp_seq=1 ttl=64 time=0.21 ms',
];

// Jendela terminal dekoratif (hanya hiasan, tersembunyi di layar sempit).
const TerminalWindow: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`select-none overflow-hidden rounded-lg border border-white/10 bg-black/40 font-mono text-[11px] leading-relaxed text-slate-500/70 shadow-xl backdrop-blur-sm ${className ?? ''}`}
  >
    <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-3 py-2">
      <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
      <span className="ml-2 text-slate-500/60">bash — jawara-isp</span>
    </div>
    <div className="px-3 py-2">
      {NET_LOGS.map((line, index) => (
        <p key={index} className={line.startsWith('root@') ? 'text-cyan-300/50' : ''}>
          {line}
        </p>
      ))}
      <p className="text-cyan-300/60">
        root@jawara-isp:~# <span className="ml-1 inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-cyan-300/60" />
      </p>
    </div>
  </div>
);

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, login } = useAuth();
  const brand = useBranding();
  const navigate = useNavigate();

  // Sudah masuk → langsung ke panel, bukan melihat form login lagi.
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const success = await login(email, password);
    setLoading(false);
    if (success) {
      navigate('/dashboard');
    } else {
      setError('Email atau password salah');
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05080c] flex items-center justify-center px-4 py-12 sm:px-6">
      {/* ===== Latar belakang (linux networking, gelap penuh) ===== */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* glow radial (cyan + hijau terminal) */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at top left, rgba(34,211,238,0.12), transparent 55%), radial-gradient(ellipse at bottom right, rgba(16,185,129,0.10), transparent 60%)',
          }}
        />
        {/* grid jaringan */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        {/* baur cahaya */}
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

        {/* jendela terminal dekoratif */}
        <TerminalWindow className="absolute left-6 top-12 hidden w-80 md:block" />
        <TerminalWindow className="absolute bottom-10 right-8 hidden w-72 lg:block" />
      </div>

      {/* ===== Kartu login (glass, kontras jelas terhadap latar) ===== */}
      <div className="relative z-10 w-full max-w-md">
        {/* pendar cahaya di belakang kartu supaya terpisah dari latar */}
        <div aria-hidden className="absolute -inset-3 rounded-3xl bg-cyan-500/10 blur-2xl" />
        <div className="relative overflow-hidden rounded-2xl border border-slate-600/60 bg-slate-900/70 shadow-2xl shadow-black/60 backdrop-blur-2xl">
          {/* aksen atas: gradasi cyan → emerald, senada terminal */}
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-cyan-400/50 to-emerald-400" />
          <div className="p-6 sm:p-8">
            <div className="text-center">
              <img
                src={brand.logo_url}
                alt=""
                className="mx-auto mb-4 h-16 w-16 rounded-2xl object-contain ring-1 ring-white/15"
              />
              <h1 className="text-2xl font-bold text-white">{brand.name}</h1>
              <p className="mt-1 text-sm text-slate-300">
                {brand.tagline || 'Masuk ke panel administrasi'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-600/60 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/25"
                  placeholder="admin@jawara-billing.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-600/60 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/25"
                  placeholder="••••••••"
                  required
                />
              </div>
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg py-3 font-semibold text-white bg-cyan-500 shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400 disabled:opacity-50"
              >
                {loading ? 'Memproses...' : 'Masuk'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
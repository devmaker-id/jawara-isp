import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { Badge, Button, errorMessage, formatBytes } from './NetUI';

interface SessionRow {
  nasipaddress: string;
  framedipaddress: string;
  acctstarttime: string | null;
  acctstoptime: string | null;
  acctsessiontime: number | null;
  acctinputoctets: number | null;
  acctoutputoctets: number | null;
  callingstationid: string;
}

interface UsageResult {
  account: {
    username: string;
    user_type: 'voucher' | 'customer' | 'member';
    profile_type: string | null;
    profile_name: string | null;
    status: string;
    expires_at: string | null;
    quota_used_bytes: number;
    online_seconds: number;
    customer_id: number | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_status: string | null;
  } | null;
  username: string;
  usage: { sessions: number; in_bytes: number; out_bytes: number; last_seen: string | null };
  active: SessionRow[];
  recent: SessionRow[];
}

const JENIS = [
  { value: 'customer', label: 'Pelanggan' },
  { value: 'voucher', label: 'Voucher' },
] as const;

const waktu = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
};

const durasi = (seconds: number | null): string => {
  if (!seconds || seconds < 1) return '—';
  const jam = Math.floor(seconds / 3600);
  const menit = Math.floor((seconds % 3600) / 60);
  return jam > 0 ? `${jam}j ${menit}m` : `${menit}m`;
};

/**
 * Dialog "Cek pemakaian user": satu tempat untuk menanyakan pemakaian satu
 * akun (pelanggan atau voucher) berdasarkan username dan/atau MAC address.
 * Hanya membaca; tidak ada perubahan data.
 */
const UsageLookupDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [jenis, setJenis] = useState<'customer' | 'voucher'>('customer');
  const [username, setUsername] = useState('');
  const [mac, setMac] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UsageResult[] | null>(null);

  // Setiap dialog ditutup, hasil dan galat lama dibuang supaya tidak
  // tertukar dengan pencarian berikutnya.
  useEffect(() => {
    if (!open) {
      setResults(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cari = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = username.trim();
    const address = mac.trim();
    if (!name && !address) {
      setError('Isi username atau MAC address dulu.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ results: UsageResult[] }>('/api/freeradius/usage', {
        params: { type: jenis, username: name || undefined, mac: address || undefined },
      });
      setResults(data.results);
    } catch (err) {
      setResults(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const field =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cek pemakaian user"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-700 bg-slate-800 text-slate-100 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
          <h2 className="text-base font-semibold">Cek pemakaian user</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={cari} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <fieldset>
            <legend className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Jenis</legend>
            <div className="flex gap-4">
              {JENIS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="radio"
                    name="jenis-pemakaian"
                    value={option.value}
                    checked={jenis === option.value}
                    onChange={() => setJenis(option.value)}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="mis. arka@jm.net"
                className={field}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">MAC address</span>
              <input
                value={mac}
                onChange={(event) => setMac(event.target.value)}
                placeholder="mis. 78:98:E8:07:F5:D0"
                className={field}
              />
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
            <p className="font-medium text-slate-300">Cara pakai</p>
            <p>1. Pilih jenis akun: Pelanggan (PPPoE/member) atau Voucher (hotspot/PPP).</p>
            <p>2. Isi username, MAC address, atau keduanya — cukup salah satu.</p>
            <p>3. Tekan Cari data. Hasil menampilkan profil, status, sesi aktif, dan total pemakaian.</p>
            <p>MAC boleh ditulis sebagian (mis. 78:98:E8) untuk mencari semua akun dari perangkat itu.</p>
          </div>

          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

          {results && (
            <div className="mt-4 space-y-3">
              {results.length === 0 && (
                <p className="text-sm text-slate-400">Tidak ada akun yang cocok dengan pencarian itu.</p>
              )}
              {results.map((row) => (
                <div key={row.username} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-slate-100">{row.username}</span>
                    {row.account ? (
                      <Badge tone={row.account.status === 'active' ? 'good' : 'mute'}>
                        {row.account.status}
                      </Badge>
                    ) : (
                      <Badge tone="mute">tidak terdaftar</Badge>
                    )}
                    {row.active.length > 0 && <Badge tone="good">online</Badge>}
                  </div>

                  <div className="mt-1 text-xs text-slate-400">
                    {row.account?.profile_name ? `${row.account.profile_type ?? ''} · ${row.account.profile_name}` : 'profil tidak diketahui'}
                    {row.account?.customer_name ? ` · ${row.account.customer_name}` : ''}
                    {row.account?.customer_phone ? ` · ${row.account.customer_phone}` : ''}
                    {row.account?.expires_at ? ` · berakhir ${waktu(row.account.expires_at)}` : ''}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Unduh</p>
                      <p className="text-slate-200">{formatBytes(row.usage.in_bytes)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Unggah</p>
                      <p className="text-slate-200">{formatBytes(row.usage.out_bytes)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Sesi</p>
                      <p className="text-slate-200">{row.usage.sessions}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Terakhir</p>
                      <p className="text-slate-200">{waktu(row.usage.last_seen)}</p>
                    </div>
                  </div>

                  {row.recent.length > 0 && (
                    <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                      {row.recent.map((session, index) => (
                        <p key={`${row.username}-${index}`}>
                          {waktu(session.acctstarttime)} · {session.nasipaddress} · IP {session.framedipaddress || '—'} ·{' '}
                          {session.callingstationid || 'MAC —'} · {durasi(session.acctsessiontime)} ·{' '}
                          {formatBytes((session.acctinputoctets ?? 0) + (session.acctoutputoctets ?? 0))}
                          {session.acctstoptime === null ? ' · aktif' : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-slate-700/60 px-4 py-3">
          <Button type="button" onClick={onClose}>
            Tutup
          </Button>
          <Button type="button" variant="primary" onClick={cari} disabled={loading}>
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
              {loading ? 'Mencari…' : 'Cari data'}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UsageLookupDialog;
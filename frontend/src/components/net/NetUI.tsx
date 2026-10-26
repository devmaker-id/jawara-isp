import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

// ===== helper tampilan bersama untuk halaman jaringan =====

export const formatNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('id-ID') : '-';

export const formatBytes = (bytes: number | null | undefined): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export const formatUptime = (seconds: number | null | undefined): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
};

export const errorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { message?: unknown }; status?: number } }).response;
  const data = response?.data?.message;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.join(', ');
  if (response?.status === 403) return 'Anda tidak berhak melakukan tindakan ini.';
  if (response?.status) return `Permintaan gagal (HTTP ${response.status}).`;
  return 'Tidak dapat menghubungi server. Periksa koneksi ke backend.';
};

export interface NetFetch<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// GET sederhana dengan status loading/error yang eksplisit supaya halaman
// tidak pernah menampilkan angka nol palsu saat data belum/tidak terbaca.
export function useNet<T>(path: string, enabled = true): NetFetch<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((response) => {
        if (alive) setData(response.data);
      })
      .catch((requestError) => {
        if (alive) {
          setData(null);
          setError(errorMessage(requestError));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, enabled, nonce]);

  return { data, loading, error, reload };
}

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
    <div>
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-400 max-w-3xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 ${className}`}>
    {children}
  </div>
);

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}> = ({ label, value, hint, tone = 'default' }) => {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-400'
        : tone === 'bad'
          ? 'text-rose-400'
          : 'text-white';
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
};

export const Badge: React.FC<{ children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'mute' }> = ({
  children,
  tone = 'mute',
}) => {
  const map = {
    good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    warn: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    bad: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    mute: 'bg-slate-600/20 text-slate-300 border-slate-600/40',
  } as const;
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${map[tone]}`}>
      {children}
    </span>
  );
};

export const ErrorNote: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
    <p className="whitespace-pre-line">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded border border-rose-400/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-500/20"
      >
        Coba lagi
      </button>
    )}
  </div>
);

export const InfoNote: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' }> = ({
  children,
  tone = 'info',
}) => (
  <div
    className={`rounded-lg border px-4 py-3 text-sm whitespace-pre-line ${
      tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        : 'border-slate-600/60 bg-slate-700/30 text-slate-300'
    }`}
  >
    {children}
  </div>
);

export const Loading: React.FC<{ label?: string }> = ({ label = 'Memuat data…' }) => (
  <div className="flex items-center gap-2 text-sm text-slate-400">
    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
    {label}
  </div>
);

export const Tabs: React.FC<{
  tabs: Array<{ key: string; label: string; count?: number }>;
  active: string;
  onChange: (key: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="flex flex-wrap gap-1 border-b border-slate-700/60 mb-4">
    {tabs.map((tab) => {
      const selected = tab.key === active;
      return (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            selected
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          {tab.label}
          {typeof tab.count === 'number' && (
            <span className="ml-1.5 text-xs text-slate-500">{tab.count}</span>
          )}
        </button>
      );
    })}
  </div>
);

export const Toolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>
);

export const SearchInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder = 'Cari…' }) => (
  <input
    type="search"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    className="w-full max-w-xs rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
  />
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }
> = ({ variant = 'ghost', className = '', ...rest }) => {
  const map = {
    primary: 'bg-cyan-600 text-white hover:bg-cyan-500 border-cyan-500',
    ghost: 'bg-slate-700/40 text-slate-200 hover:bg-slate-700 border-slate-600',
    danger: 'bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border-rose-500/40',
  } as const;
  return (
    <button
      {...rest}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${map[variant]} ${className}`}
    />
  );
};

export const Table: React.FC<{
  columns: string[];
  children: React.ReactNode;
  empty?: string;
  isEmpty?: boolean;
}> = ({ columns, children, empty = 'Tidak ada data.', isEmpty }) => (
  <div className="overflow-x-auto rounded-xl border border-slate-700/60">
    <table className="min-w-full text-sm">
      <thead className="bg-slate-800/80 text-left text-xs uppercase tracking-wide text-slate-400">
        <tr>
          {columns.map((column) => (
            <th key={column} className="px-3 py-2 font-medium whitespace-nowrap">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-700/60 text-slate-200">
        {isEmpty ? (
          <tr>
            <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">
              {empty}
            </td>
          </tr>
        ) : (
          children
        )}
      </tbody>
    </table>
  </div>
);
// ===== pemilihan perangkat MikroTik =====
// Pengguna bisa punya banyak router. Pilihan disimpan di localStorage supaya
// berpindah halaman tidak mengembalikan ke perangkat pertama.

export const DEVICE_STORAGE_KEY = 'mikrotik_device';

export interface MikrotikDevice {
  id: number;
  name: string;
  host: string;
  api_port: number;
  api_user: string;
  gui_url: string | null;
  description: string | null;
  write_enabled: boolean;
  is_active: boolean;
  password_set: boolean;
  password_encrypted: boolean;
  last_checked_at: string | null;
  last_connected: boolean | null;
  last_message: string | null;
  last_identity: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DeviceListPayload {
  ready: boolean;
  migration: string;
  default_device_id: number | null;
  rows: MikrotikDevice[];
}

export interface DeviceSelection {
  devices: MikrotikDevice[];
  ready: boolean;
  migration: string;
  loading: boolean;
  error: string | null;
  deviceId: number | null;
  device: MikrotikDevice | null;
  // Siap ditempel ke path API: '' atau '?device=3'
  query: string;
  setDeviceId: (id: number | null) => void;
  reload: () => void;
}

export function useDeviceSelection(): DeviceSelection {
  const list = useNet<DeviceListPayload>('/api/mikrotik/devices');
  const [deviceId, setStoredDeviceId] = useState<number | null>(() => {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY);
    const parsed = Number(raw);
    return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });

  const devices = list.data?.rows ?? [];

  // Perangkat terpilih bisa hilang (dihapus/dinonaktifkan): pilih ulang.
  useEffect(() => {
    if (!list.data?.ready) return;
    const exists = devices.some((item) => item.id === deviceId && item.is_active);
    if (exists) return;
    const fallback = list.data.default_device_id ?? devices.find((item) => item.is_active)?.id ?? null;
    if (fallback !== deviceId) {
      setStoredDeviceId(fallback);
      if (fallback) localStorage.setItem(DEVICE_STORAGE_KEY, String(fallback));
      else localStorage.removeItem(DEVICE_STORAGE_KEY);
    }
  }, [list.data, devices, deviceId]);

  const setDeviceId = useCallback((id: number | null) => {
    setStoredDeviceId(id);
    if (id) localStorage.setItem(DEVICE_STORAGE_KEY, String(id));
    else localStorage.removeItem(DEVICE_STORAGE_KEY);
  }, []);

  return {
    devices,
    ready: list.data?.ready ?? false,
    migration: list.data?.migration ?? '',
    loading: list.loading,
    error: list.error,
    deviceId,
    device: devices.find((item) => item.id === deviceId) ?? null,
    query: deviceId ? `?device=${deviceId}` : '',
    setDeviceId,
    reload: list.reload,
  };
}

// Bar pemilih perangkat: selalu tampil di halaman MikroTik agar operator tahu
// data yang sedang dilihat berasal dari router mana.
export const DeviceBar: React.FC<{ selection: DeviceSelection }> = ({ selection }) => {
  const { devices, deviceId, device, ready, loading, error, migration, setDeviceId } = selection;

  if (loading && devices.length === 0) {
    return <InfoNote>Memuat daftar perangkat MikroTik...</InfoNote>;
  }

  if (error) {
    return <ErrorNote message={error} onRetry={selection.reload} />;
  }

  if (!ready) {
    return (
      <InfoNote tone="warn">
        Tabel daftar perangkat belum ada. Jalankan migrasi <code>{migration || '005_mikrotik_devices.sql'}</code>{' '}
        setelah backup database. Sementara itu panel memakai konfigurasi tunggal di Pengaturan → Integrasi.
      </InfoNote>
    );
  }

  if (devices.length === 0) {
    return (
      <InfoNote tone="warn">
        Belum ada perangkat MikroTik terdaftar.{' '}
        <a className="font-semibold underline" href="/mikrotik/perangkat">
          Tambahkan perangkat
        </a>{' '}
        agar data bisa dibaca lewat API.
      </InfoNote>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/60 px-4 py-3 text-sm text-slate-200">
      <span className="font-medium text-slate-400">Perangkat:</span>
      <select
        className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-100"
        value={deviceId ?? ''}
        onChange={(event) => setDeviceId(event.target.value ? Number(event.target.value) : null)}
      >
        {devices.map((item) => (
          <option key={item.id} value={item.id} disabled={!item.is_active}>
            {item.name} — {item.host}:{item.api_port}
            {item.is_active ? '' : ' (nonaktif)'}
          </option>
        ))}
      </select>
      {device?.last_connected === true && <Badge tone="good">Terhubung</Badge>}
      {device?.last_connected === false && <Badge tone="bad">Gagal terhubung</Badge>}
      {device?.last_connected === null && <Badge tone="mute">Belum diuji</Badge>}
      {device?.last_message && (
        <span className="text-xs text-slate-500" title={device.last_message}>
          {device.last_message.slice(0, 80)}
        </span>
      )}
      {device?.gui_url && (
        <a
          className="ml-auto text-xs font-semibold text-cyan-400 underline"
          href={device.gui_url}
          target="_blank"
          rel="noreferrer"
        >
          Buka WebFig
        </a>
      )}
    </div>
  );
};

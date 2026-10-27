import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';

/**
 * Matriks hak akses satu akun.
 *
 * Dikirim sebagai daftar LENGKAP kode yang dicentang (bukan diff): backend
 * menghitung sendiri selisihnya terhadap default role, sehingga tombol
 * "kembalikan ke default" tetap punya arti.
 */

type Role = 'admin' | 'operator' | 'resseler';

interface PermissionItem {
  code: string;
  label: string;
  module: string;
  allowed: boolean;
  source: 'role' | 'user';
}

interface Payload {
  user_id: number;
  role: Role;
  permissions: PermissionItem[];
  role_defaults: string[];
}

const MODULE_LABEL: Record<string, string> = {
  customer: 'Pelanggan',
  profile: 'Profil layanan',
  group: 'Group profile',
  bandwidth: 'Bandwidth',
  voucher: 'Voucher',
  device: 'Perangkat MikroTik',
  nas: 'NAS RADIUS',
  radius: 'FreeRADIUS',
  isolir: 'Profil isolir',
  invoice: 'Tagihan',
  payment: 'Pembayaran',
  report: 'Laporan',
  tools: 'Tools database',
  user: 'Pengguna & hak akses',
};

const MODULE_ORDER = [
  'customer', 'profile', 'group', 'bandwidth', 'voucher', 'device', 'nas',
  'radius', 'isolir', 'invoice', 'payment', 'report', 'tools', 'user',
];

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

interface Props {
  userId: number;
  userName: string;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (text: string) => void;
}

const PermissionMatrix: React.FC<Props> = ({ userId, userName, isSelf, onClose, onSaved }) => {
  const [data, setData] = useState<Payload | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Payload>(`/api/admin/users/${userId}/permissions`);
      setData(res.data);
      setChecked(new Set(res.data.permissions.filter((p) => p.allowed).map((p) => p.code)));
    } catch (err) {
      setError(readError(err, 'Gagal memuat hak akses akun.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ module: string; items: PermissionItem[] }>;
    const map = new Map<string, PermissionItem[]>();
    for (const item of data.permissions) {
      const list = map.get(item.module) ?? [];
      list.push(item);
      map.set(item.module, list);
    }
    return [...map.entries()]
      .sort((a, b) => MODULE_ORDER.indexOf(a[0]) - MODULE_ORDER.indexOf(b[0]))
      .map(([module, items]) => ({ module, items }));
  }, [data]);

  const defaults = useMemo(() => new Set(data?.role_defaults ?? []), [data]);

  const toggle = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleModule = (module: string) => {
    const items = grouped.find((g) => g.module === module)?.items ?? [];
    const allOn = items.every((i) => checked.has(i.code));
    setChecked((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (allOn) next.delete(item.code);
        else next.add(item.code);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/admin/users/${userId}/permissions`, { codes: [...checked] });
      onSaved(`Hak akses ${userName} disimpan (${checked.size} izin aktif).`);
      onClose();
    } catch (err) {
      setError(readError(err, 'Gagal menyimpan hak akses.'));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/admin/users/${userId}/permissions/reset`);
      onSaved(`Hak akses ${userName} dikembalikan ke default role.`);
      await load();
    } catch (err) {
      setError(readError(err, 'Gagal mengembalikan ke default.'));
    } finally {
      setSaving(false);
    }
  };

  const changed = data
    ? data.permissions.filter((p) => checked.has(p.code) !== p.allowed).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Hak akses ${userName}`}
        className="w-full max-w-3xl my-6 rounded-xl bg-slate-800 border border-slate-700 p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Hak akses — {userName}</h2>
            <p className="text-xs text-slate-400 mt-1">
              {data ? (
                <>
                  Role <span className="text-cyan-300">{data.role}</span> ·{' '}
                  {checked.size} izin aktif
                  {changed > 0 && (
                    <span className="text-amber-300"> · {changed} perubahan belum disimpan</span>
                  )}
                </>
              ) : (
                'Memuat…'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 transition"
          >
            Tutup
          </button>
        </div>

        {isSelf && (
          <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            Ini akun Anda sendiri. Hak akses akun sendiri tidak dapat diubah dari akun itu —
            minta admin lain mengubahnya agar Anda tidak terkunci di luar halaman ini.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Memuat hak akses…</p>
        ) : (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {grouped.map((group) => {
              const allOn = group.items.every((i) => checked.has(i.code));
              return (
                <div key={group.module} className="rounded-lg border border-slate-700/60 overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-700/30 px-3 py-2">
                    <span className="text-sm font-medium text-slate-200">
                      {MODULE_LABEL[group.module] ?? group.module}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleModule(group.module)}
                      disabled={isSelf}
                      className="text-xs text-cyan-300 hover:text-cyan-200 disabled:opacity-40 transition"
                    >
                      {allOn ? 'Kosongkan' : 'Centang semua'}
                    </button>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2 px-3 py-2">
                    {group.items.map((item) => {
                      const isDefault = defaults.has(item.code);
                      const overridden = item.source === 'user';
                      return (
                        <label
                          key={item.code}
                          className="flex items-start gap-2 text-sm text-slate-300 py-1 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(item.code)}
                            onChange={() => toggle(item.code)}
                            disabled={isSelf}
                            className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-700 text-cyan-500 focus:ring-cyan-500/30 disabled:opacity-40"
                          />
                          <span className="leading-snug">
                            {item.label}
                            {!isDefault && (
                              <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-400/80">
                                bukan default
                              </span>
                            )}
                            {overridden && (
                              <span className="ml-1 text-[10px] uppercase tracking-wide text-cyan-400/80">
                                khusus
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => void reset()}
            disabled={saving || isSelf}
            className="px-3 py-2 rounded-lg text-sm text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 transition"
          >
            Kembalikan ke default role
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || isSelf || loading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 transition"
          >
            {saving ? 'Menyimpan…' : 'Simpan hak akses'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionMatrix;

import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

/**
 * Pemilih pemilik data (admin/operator/reseller).
 *
 * Hanya ADMIN yang melihat dropdown. Role lain selalu menjadi pemilik data
 * yang dibuatnya, jadi yang ditampilkan cukup keterangan terkunci — server
 * tetap menimpa nilainya walau field ini dimanipulasi.
 *
 * Daftar akun diambil dari /api/admin/owners (endpoint admin-only), sehingga
 * untuk non-admin komponen ini tidak melakukan permintaan sama sekali.
 */

export interface OwnerOption {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface Props {
  /** '' = ikut pemilik induk (mis. pemilik profil), 'none' = tanpa pemilik. */
  value: string;
  onChange: (value: string) => void;
  /** Label sumber warisan, mis. "HS-WARKOP (Reseller A)". */
  inheritedFrom?: string | null;
  label?: string;
  id?: string;
  disabled?: boolean;
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 outline-none transition text-slate-100 text-sm';

export const OwnerSelect: React.FC<Props> = ({
  value,
  onChange,
  inheritedFrom,
  label = 'Pemilik',
  id = 'owner-select',
  disabled = false,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [options, setOptions] = useState<OwnerOption[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<OwnerOption[]>('/api/admin/owners')
      .then((res) => setOptions(Array.isArray(res.data) ? res.data : []))
      .catch(() => setOptions([]));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div>
        <label className="block text-xs text-slate-400 mb-1">{label}</label>
        <p className="px-3 py-2 rounded-lg bg-slate-700/40 border border-slate-600/60 text-sm text-slate-300">
          {user?.name ?? 'Akun Anda'} — otomatis, tidak dapat diubah.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">— Ikut pemilik induk —</option>
        <option value="none">— Tanpa pemilik (internal) —</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} — {option.email} ({option.role})
          </option>
        ))}
      </select>
      {inheritedFrom && (
        <p className="text-[11px] text-slate-500 mt-1">Otomatis dari: {inheritedFrom}. Boleh diganti.</p>
      )}
    </div>
  );
};

export default OwnerSelect;

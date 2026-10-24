import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface PackageItem {
  id: number;
  name: string;
  description: string;
  price: number;
  data_limit: string;
  speed: number;
  valid_days: number;
  is_active: boolean;
  created_at: string;
}

interface PackageForm {
  name: string;
  description: string;
  price: string;
  data_limit: string;
  speed: string;
  valid_days: string;
  is_active: boolean;
}

const EMPTY_FORM: PackageForm = {
  name: '',
  description: '',
  price: '',
  data_limit: '',
  speed: '',
  valid_days: '30',
  is_active: true,
};

type Toast = { type: 'success' | 'error'; text: string } | null;

// Harga berasal dari DECIMAL(12,2). Format rupiah tanpa membuang desimal bila ada.
const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  return `Rp ${value.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const Packages: React.FC = () => {
  const { user } = useAuth();
  // Mutasi paket adalah wewenang admin; tombol disembunyikan untuk role lain,
  // tetapi penegakan sebenarnya ada di RolesGuard backend (403).
  const canMutate = user?.role === 'admin';

  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PackageItem | null>(null);
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<PackageItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.get('/api/packages');
      setPackages(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setLoadError(readError(error, 'Gagal memuat data paket. Periksa koneksi ke server.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return packages;
    return packages.filter(
      (p) =>
        p.name.toLowerCase().includes(keyword) ||
        p.data_limit.toLowerCase().includes(keyword),
    );
  }, [packages, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (pkg: PackageItem) => {
    setEditing(pkg);
    setForm({
      name: pkg.name,
      description: pkg.description ?? '',
      price: String(pkg.price),
      data_limit: pkg.data_limit,
      speed: String(pkg.speed),
      valid_days: String(pkg.valid_days),
      is_active: pkg.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setFormError(null);
  };

  const validate = (): string | null => {
    if (form.name.trim().length < 2) return 'Nama paket minimal 2 karakter.';
    if (form.description.trim().length === 0) return 'Deskripsi wajib diisi.';
    if (form.data_limit.trim().length === 0) return 'Kuota/data limit wajib diisi.';

    const price = Number(form.price.replace(',', '.'));
    if (!form.price.trim() || !Number.isFinite(price)) return 'Harga harus berupa angka.';
    if (price < 0) return 'Harga tidak boleh negatif.';
    // Backend menolak lebih dari 2 desimal; cegah sebelum request.
    if (!/^\d+(\.\d{1,2})?$/.test(form.price.trim().replace(',', '.'))) {
      return 'Harga maksimal 2 angka desimal.';
    }

    const speed = Number(form.speed);
    if (!Number.isInteger(speed) || speed < 1) return 'Kecepatan harus bilangan bulat minimal 1.';

    const validDays = Number(form.valid_days);
    if (!Number.isInteger(validDays) || validDays < 1) return 'Masa aktif harus bilangan bulat minimal 1.';

    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: Number(form.price.replace(',', '.')),
      data_limit: form.data_limit.trim(),
      speed: Number(form.speed),
      valid_days: Number(form.valid_days),
      is_active: form.is_active,
    };

    try {
      if (editing) {
        const response = await api.patch(`/api/packages/${editing.id}`, payload);
        setPackages((prev) => prev.map((p) => (p.id === editing.id ? response.data : p)));
        setToast({ type: 'success', text: 'Paket berhasil diperbarui.' });
      } else {
        const response = await api.post('/api/packages', payload);
        setPackages((prev) => [response.data, ...prev]);
        setToast({ type: 'success', text: 'Paket baru berhasil ditambahkan.' });
      }
      setModalOpen(false);
      setEditing(null);
    } catch (error) {
      setFormError(readError(error, 'Gagal menyimpan paket.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmTarget || deleting) return;
    setDeleting(true);
    try {
      await api.delete(`/api/packages/${confirmTarget.id}`);
      setPackages((prev) => prev.filter((p) => p.id !== confirmTarget.id));
      setToast({ type: 'success', text: `Paket "${confirmTarget.name}" berhasil dihapus.` });
      setConfirmTarget(null);
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menghapus paket.') });
      setConfirmTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Paket Internet</h1>
          <p className="text-slate-400 text-sm mt-1">Kelola paket data dan harga langganan</p>
        </div>
        {canMutate && (
          <button
            type="button"
            onClick={openCreate}
            className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tambah Paket
          </button>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama atau kuota paket..."
          className={inputClass}
          aria-label="Cari paket"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-44 rounded-xl bg-slate-800/50 border border-slate-700/50 animate-pulse"
            />
          ))}
        </div>
      ) : loadError ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center space-y-3">
          <p className="text-sm text-red-400">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
          >
            Coba lagi
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-10 text-center space-y-2">
          <p className="text-slate-300 font-medium">
            {packages.length === 0 ? 'Belum ada paket' : 'Tidak ada hasil'}
          </p>
          <p className="text-sm text-slate-500">
            {packages.length === 0
              ? canMutate
                ? 'Tambahkan paket pertama untuk mulai menawarkan layanan.'
                : 'Belum ada paket yang tersedia.'
              : 'Coba kata kunci lain atau kosongkan pencarian.'}
          </p>
          {packages.length === 0 && canMutate && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 transition"
            >
              Tambah Paket
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition flex flex-col"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-white break-words">{pkg.name}</h3>
                  <p className="text-sm text-slate-400 mt-1 break-words">
                    {pkg.data_limit.toLowerCase() === 'unlimited' || pkg.data_limit === '-'
                      ? 'Unlimited'
                      : `Limit: ${pkg.data_limit}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium ${
                    pkg.is_active
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-slate-500/10 text-slate-400'
                  }`}
                >
                  {pkg.is_active ? 'Aktif' : 'Tidak Aktif'}
                </span>
              </div>

              {pkg.description && (
                <p className="mt-2 text-xs text-slate-500 line-clamp-2">{pkg.description}</p>
              )}

              <div className="mt-4 flex items-center gap-4 text-sm text-slate-300">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {pkg.speed} Mbps
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {pkg.valid_days} hari
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-slate-700/40">
                <span className="text-lg font-bold text-cyan-400">{formatPrice(pkg.price)}</span>
                {canMutate && (
                  <div className="flex gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(pkg)}
                      className="text-sm text-slate-400 hover:text-cyan-400 transition"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(pkg)}
                      className="text-sm text-slate-400 hover:text-red-400 transition"
                    >
                      Hapus
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !loadError && filtered.length > 0 && (
        <p className="text-xs text-slate-500">
          Menampilkan {filtered.length} dari {packages.length} paket
        </p>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="package-modal-title"
            className="w-full sm:max-w-lg bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 id="package-modal-title" className="text-lg font-semibold text-white">
                  {editing ? 'Ubah Paket' : 'Tambah Paket'}
                </h2>
                <button
                  type="button"
                  onClick={closeModal}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition"
                  aria-label="Tutup"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-name">
                  Nama Paket *
                </label>
                <input
                  id="p-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                  placeholder="30Mbps Unlimited"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-desc">
                  Deskripsi *
                </label>
                <textarea
                  id="p-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className={`${inputClass} resize-y`}
                  placeholder="Keterangan singkat paket"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-price">
                    Harga (Rp) *
                  </label>
                  <input
                    id="p-price"
                    type="text"
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className={inputClass}
                    placeholder="49500.50"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">Maksimal 2 angka desimal.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-limit">
                    Kuota / Data Limit *
                  </label>
                  <input
                    id="p-limit"
                    type="text"
                    value={form.data_limit}
                    onChange={(e) => setForm((f) => ({ ...f, data_limit: e.target.value }))}
                    className={inputClass}
                    placeholder="Unlimited atau 30GB"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-speed">
                    Kecepatan (Mbps) *
                  </label>
                  <input
                    id="p-speed"
                    type="number"
                    min={1}
                    step={1}
                    value={form.speed}
                    onChange={(e) => setForm((f) => ({ ...f, speed: e.target.value }))}
                    className={inputClass}
                    placeholder="30"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-days">
                    Masa Aktif (hari) *
                  </label>
                  <input
                    id="p-days"
                    type="number"
                    min={1}
                    step={1}
                    value={form.valid_days}
                    onChange={(e) => setForm((f) => ({ ...f, valid_days: e.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500/30"
                />
                Paket aktif dan dapat ditawarkan
              </label>

              {formError && (
                <p role="alert" className="text-sm text-red-400">
                  {formError}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
                >
                  {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-package-title"
            className="w-full max-w-sm bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <h2 id="confirm-package-title" className="text-lg font-semibold text-white">
              Hapus paket?
            </h2>
            <p className="text-sm text-slate-400">
              Paket <span className="text-slate-200 font-medium">{confirmTarget.name}</span> akan dihapus permanen.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-400 disabled:opacity-50 transition"
              >
                {deleting ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Packages;

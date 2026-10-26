import React, { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import TablePagination from '../components/TablePagination';

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  created_at: string;
  // Diisi server hanya setelah kolom customers.reseller_id ada (migrasi 003).
  reseller_id?: number | null;
}

const PAGE_LIMIT = 10;

interface CustomerForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  is_active: true,
};

type Toast = { type: 'success' | 'error'; text: string } | null;

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Ambil pesan dari backend agar pengguna melihat alasan sebenarnya
// (409 email duplikat, 400 validasi), bukan pesan generik.
const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const Customers: React.FC = () => {
  const { user } = useAuth();
  // Hapus pelanggan hanya untuk admin (RolesGuard backend menolak 403 untuk
  // role lain). Tombol disembunyikan agar tidak menjadi aksi yang pasti gagal.
  const canDelete = user?.role === 'admin';

  const canAssignOwner = user?.role === 'admin';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [ownerAvailable, setOwnerAvailable] = useState(false);
  const [ownerTarget, setOwnerTarget] = useState<Customer | null>(null);
  const [ownerValue, setOwnerValue] = useState('');
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [resellerOptions, setResellerOptions] = useState<Array<{ id: number; name: string; email: string }>>([]);
  const [toast, setToast] = useState<Toast>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Pagination & pencarian dikerjakan server: tidak ada lagi ambil-semua +
  // filter di useMemo.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.get('/api/customers', {
        params: { page, limit: PAGE_LIMIT, search: debouncedSearch || undefined },
      });
      const data = response.data;
      if (Array.isArray(data)) {
        setCustomers(data);
        setTotal(data.length);
      } else {
        setCustomers(Array.isArray(data?.rows) ? data.rows : []);
        setTotal(Number(data?.total ?? 0));
      }
    } catch (error) {
      setCustomers([]);
      setTotal(0);
      setLoadError(readError(error, 'Gagal memuat data pelanggan. Periksa koneksi ke server.'));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounce pencarian agar tidak membanjiri API.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Kemampuan penetapan pemilik reseller (belum aktif sebelum migrasi 003).
  useEffect(() => {
    api
      .get('/api/customers/meta')
      .then((res) => setOwnerAvailable(Boolean(res.data?.owner_assignment)))
      .catch(() => setOwnerAvailable(false));
  }, []);

  useEffect(() => {
    if (!canAssignOwner || !ownerAvailable) return;
    api
      .get('/api/admin/users', { params: { page: 1, limit: 200, role: 'resseler', status: 'active' } })
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : res.data?.rows ?? [];
        setResellerOptions(rows);
      })
      .catch(() => setResellerOptions([]));
  }, [canAssignOwner, ownerAvailable]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setForm({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address ?? '',
      is_active: customer.is_active,
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
    if (form.name.trim().length < 2) return 'Nama minimal 2 karakter.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Format email tidak valid.';
    if (!/^[0-9+\-\s()]{6,20}$/.test(form.phone.trim())) return 'Nomor telepon tidak valid (6-20 digit).';
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      is_active: form.is_active,
    };

    try {
      if (editing) {
        await api.patch(`/api/customers/${editing.id}`, payload);
        setToast({ type: 'success', text: 'Data pelanggan berhasil diperbarui.' });
      } else {
        await api.post('/api/customers', payload);
        setToast({ type: 'success', text: 'Pelanggan baru berhasil ditambahkan.' });
      }
      await load();
      setModalOpen(false);
      setEditing(null);
    } catch (error) {
      setFormError(readError(error, 'Gagal menyimpan data pelanggan.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/customers/${confirmTarget.id}`);
      setToast({ type: 'success', text: `Pelanggan "${confirmTarget.name}" berhasil dihapus.` });
      setConfirmTarget(null);
      await load();
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menghapus pelanggan.') });
      setConfirmTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const resellerLabel = (id: number | null | undefined): string => {
    if (!id) return 'Belum ditugaskan';
    const found = resellerOptions.find((option) => option.id === Number(id));
    return found ? found.name : `Reseller #${id}`;
  };

  const handleAssignOwner = async () => {
    if (!ownerTarget) return;
    setOwnerSaving(true);
    try {
      const resellerId = ownerValue === '' ? null : Number(ownerValue);
      const response = await api.patch(`/api/customers/${ownerTarget.id}/owner`, {
        reseller_id: resellerId,
      });
      const previous = response.data?.previous_owner_id ?? null;
      setToast({
        type: 'success',
        text:
          resellerId === null
            ? `Kepemilikan "${ownerTarget.name}" dilepas (sebelumnya: ${previous ?? 'tanpa pemilik'}).`
            : `Pemilik "${ownerTarget.name}" ditetapkan. Pemilik sebelumnya: ${previous ?? 'tanpa pemilik'}.`,
      });
      setOwnerTarget(null);
      setOwnerValue('');
      await load();
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menetapkan pemilik pelanggan.') });
      setOwnerTarget(null);
    } finally {
      setOwnerSaving(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pelanggan</h1>
          <p className="text-slate-400 text-sm mt-1">Kelola data pelanggan dan status layanan mereka</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Pelanggan
        </button>
      </div>

      {/* Notifikasi hasil operasi */}
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

      {/* Status fitur kepemilikan reseller (Fase 0: belum aktif sebelum migrasi) */}
      {!ownerAvailable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Penetapan pemilik reseller belum aktif: kolom <code>customers.reseller_id</code> belum ada.
          Menunggu migrasi <code>003_customer_reseller_ownership.sql</code>. Semua pelanggan saat ini
          berstatus <span className="font-semibold">belum ditugaskan</span> dan hanya terlihat oleh
          admin/operator.
        </div>
      )}

      {/* Pencarian */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, email, atau telepon..."
          className={inputClass}
          aria-label="Cari pelanggan"
        />
      </div>

      {/* Daftar */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-700/40 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-red-400">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
            >
              Coba lagi
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-slate-300 font-medium">
              {debouncedSearch ? 'Tidak ada hasil' : 'Belum ada pelanggan'}
            </p>
            <p className="text-sm text-slate-500">
              {debouncedSearch
                ? 'Coba kata kunci lain atau kosongkan pencarian.'
                : 'Tambahkan pelanggan pertama untuk mulai mengelola layanan.'}
            </p>
            {!debouncedSearch && (
              <button
                type="button"
                onClick={openCreate}
                className="mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 transition"
              >
                Tambah Pelanggan
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Tabel: tablet & desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700/50 bg-slate-700/30">
                    <th className="px-4 py-3 font-medium">Nama</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Telepon</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {ownerAvailable && <th className="px-4 py-3 font-medium">Pemilik</th>}
                    <th className="px-4 py-3 font-medium">Bergabung</th>
                    <th className="px-4 py-3 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-700/20 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{customer.name}</div>
                        {customer.address && (
                          <div className="text-xs text-slate-500 truncate max-w-[220px]">{customer.address}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{customer.email}</td>
                      <td className="px-4 py-3 text-slate-300">{customer.phone}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            customer.is_active
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-slate-500/10 text-slate-400'
                          }`}
                        >
                          {customer.is_active ? 'Aktif' : 'Tidak Aktif'}
                        </span>
                      </td>
                      {ownerAvailable && (
                        <td className="px-4 py-3 text-slate-400">
                          {customer.reseller_id ? (
                            resellerLabel(customer.reseller_id)
                          ) : (
                            <span className="text-slate-500">Belum ditugaskan</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-slate-400">{formatDate(customer.created_at)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(customer)}
                          className="text-cyan-400 hover:text-cyan-300 transition mr-3"
                        >
                          Ubah
                        </button>
                        {canAssignOwner && ownerAvailable && (
                          <button
                            type="button"
                            onClick={() => {
                              setOwnerTarget(customer);
                              setOwnerValue(customer.reseller_id ? String(customer.reseller_id) : '');
                            }}
                            className="text-amber-300 hover:text-amber-200 transition mr-3"
                          >
                            Pemilik
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(customer)}
                            className="text-red-400 hover:text-red-300 transition"
                          >
                            Hapus
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Kartu: mobile */}
            <div className="md:hidden divide-y divide-slate-700/50">
              {customers.map((customer) => (
                <div key={customer.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{customer.name}</p>
                      <p className="text-xs text-slate-400 truncate">{customer.email}</p>
                      <p className="text-xs text-slate-400">{customer.phone}</p>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium ${
                        customer.is_active
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-slate-500/10 text-slate-400'
                      }`}
                    >
                      {customer.is_active ? 'Aktif' : 'Tidak Aktif'}
                    </span>
                  </div>
                  {customer.address && <p className="text-xs text-slate-500 break-words">{customer.address}</p>}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-slate-500">{formatDate(customer.created_at)}</span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => openEdit(customer)}
                        className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition"
                      >
                        Ubah
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(customer)}
                          className="text-xs font-medium text-red-400 hover:text-red-300 transition"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {!loadError && (
        <TablePagination
          page={page}
          total={total}
          limit={PAGE_LIMIT}
          loading={loading}
          unit="pelanggan"
          onPage={setPage}
        />
      )}

      {/* Modal tambah/ubah */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-modal-title"
            className="w-full sm:max-w-lg bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 id="customer-modal-title" className="text-lg font-semibold text-white">
                  {editing ? 'Ubah Pelanggan' : 'Tambah Pelanggan'}
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
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-name">
                  Nama Lengkap *
                </label>
                <input
                  id="c-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Nama pelanggan"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-email">
                  Email *
                </label>
                <input
                  id="c-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className={inputClass}
                  placeholder="nama@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-phone">
                  No. Telepon *
                </label>
                <input
                  id="c-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className={inputClass}
                  placeholder="08xxxxxxxxxx"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-address">
                  Alamat
                </label>
                <textarea
                  id="c-address"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  rows={3}
                  className={`${inputClass} resize-y`}
                  placeholder="Alamat lengkap"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500/30"
                />
                Pelanggan aktif
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

      {/* Konfirmasi hapus */}
      {ownerTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-title"
            className="w-full max-w-md bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <h2 id="owner-title" className="text-lg font-semibold text-white">
              Tetapkan pemilik pelanggan
            </h2>
            <p className="text-sm text-slate-400">
              <span className="text-slate-200 font-medium">{ownerTarget.name}</span> — pemilik saat ini:{' '}
              {resellerLabel(ownerTarget.reseller_id)}
            </p>
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="owner-select">
                Reseller
              </label>
              <select
                id="owner-select"
                value={ownerValue}
                onChange={(e) => setOwnerValue(e.target.value)}
                className={inputClass}
              >
                <option value="">— Lepas kepemilikan (tanpa reseller) —</option>
                {resellerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-2">
                Melepas kepemilikan membuat pelanggan hanya terlihat oleh admin/operator. Tagihan,
                pembayaran, dan layanan tidak diubah.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setOwnerTarget(null)}
                disabled={ownerSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleAssignOwner()}
                disabled={ownerSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
              >
                {ownerSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-sm bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <h2 id="confirm-title" className="text-lg font-semibold text-white">
              Hapus pelanggan?
            </h2>
            <p className="text-sm text-slate-400">
              Data <span className="text-slate-200 font-medium">{confirmTarget.name}</span> akan dihapus permanen.
            </p>
            <p className="text-xs text-slate-500">
              Pelanggan yang sudah punya tagihan atau sesi layanan tidak dapat dihapus — server akan
              menolak (409) dan menyarankan penonaktifan agar riwayat tetap tersimpan.
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

export default Customers;

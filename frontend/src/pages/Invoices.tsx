import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface InvoiceItem {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  amount: number;
  status: 'unpaid' | 'paid' | 'overdue';
  due_date: string;
  paid_date: string | null;
  description: string;
  created_at: string;
}

interface Summary {
  total: number;
  paid: number;
  unpaid: number;
  overdue: number;
}

interface CustomerOption {
  id: number;
  name: string;
}

interface InvoiceForm {
  customer_id: string;
  amount: string;
  due_date: string;
  description: string;
}

interface PayForm {
  amount: string;
  paid_date: string;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

// Tanggal lokal (bukan UTC): toISOString() bisa mundur sehari di WIB.
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
};

const EMPTY_FORM: InvoiceForm = { customer_id: '', amount: '', due_date: today(), description: '' };

// DECIMAL(12,2): tampilkan maksimal 2 desimal tanpa membuang nilainya.
const formatRupiah = (value: number): string =>
  Number.isFinite(value)
    ? `Rp ${value.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : '-';

const formatDate = (iso: string | null): string => {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const STATUS_LABEL: Record<InvoiceItem['status'], string> = {
  paid: 'Lunas',
  overdue: 'Terlambat',
  unpaid: 'Belum bayar',
};

const STATUS_CLASS: Record<InvoiceItem['status'], string> = {
  paid: 'bg-emerald-500/10 text-emerald-400',
  overdue: 'bg-red-500/10 text-red-400',
  unpaid: 'bg-amber-500/10 text-amber-400',
};

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const parseAmount = (raw: string): number => Number(raw.trim().replace(',', '.'));

const amountError = (raw: string): string | null => {
  const trimmed = raw.trim().replace(',', '.');
  if (!trimmed) return 'Nominal wajib diisi.';
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return 'Nominal harus angka dengan maksimal 2 desimal.';
  if (Number(trimmed) <= 0) return 'Nominal harus lebih dari 0.';
  return null;
};

const Invoices: React.FC = () => {
  const { user } = useAuth();
  // Penegakan sebenarnya ada di RolesGuard: operator boleh membuat/mengubah/
  // membayar, penghapusan khusus admin.
  const canWrite = user?.role === 'admin' || user?.role === 'operator';
  const canDelete = user?.role === 'admin';

  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceItem['status']>('all');

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceItem | null>(null);
  const [form, setForm] = useState<InvoiceForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<InvoiceItem | null>(null);

  const [payTarget, setPayTarget] = useState<InvoiceItem | null>(null);
  const [payForm, setPayForm] = useState<PayForm>({ amount: '', paid_date: today() });
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<InvoiceItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, stats] = await Promise.all([
        api.get('/api/invoices'),
        api.get('/api/invoices/summary'),
      ]);
      setInvoices(Array.isArray(list.data) ? list.data : []);
      setSummary(stats.data ?? null);
    } catch (error) {
      setLoadError(readError(error, 'Gagal memuat tagihan. Periksa koneksi ke server.'));
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

  useEffect(() => {
    if (!formOpen || editing || !canWrite) return;
    api
      .get('/api/customers')
      .then((res) => setCustomers(Array.isArray(res.data) ? res.data : []))
      .catch(() => setFormError('Gagal memuat daftar pelanggan.'));
  }, [formOpen, editing, canWrite]);

  const visible = useMemo(
    () => (statusFilter === 'all' ? invoices : invoices.filter((i) => i.status === statusFilter)),
    [invoices, statusFilter],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (invoice: InvoiceItem) => {
    setEditing(invoice);
    setForm({
      customer_id: String(invoice.customer_id),
      amount: String(invoice.amount),
      due_date: invoice.due_date.slice(0, 10),
      description: invoice.description ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
  };

  const validateForm = (): string | null => {
    if (!editing && !form.customer_id) return 'Pelanggan wajib dipilih.';
    const err = amountError(form.amount);
    if (err) return err;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.due_date)) return 'Jatuh tempo wajib diisi.';
    if (form.description.length > 255) return 'Deskripsi maksimal 255 karakter.';
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const invalid = validateForm();
    if (invalid) {
      setFormError(invalid);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/api/invoices/${editing.id}`, {
          amount: parseAmount(form.amount),
          due_date: form.due_date,
          description: form.description.trim(),
        });
        setToast({ type: 'success', text: 'Tagihan berhasil diperbarui.' });
      } else {
        await api.post('/api/invoices', {
          customer_id: Number(form.customer_id),
          amount: parseAmount(form.amount),
          due_date: form.due_date,
          description: form.description.trim(),
        });
        setToast({ type: 'success', text: 'Tagihan berhasil dibuat.' });
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      setFormError(readError(error, 'Gagal menyimpan tagihan.'));
    } finally {
      setSaving(false);
    }
  };

  const openPay = (invoice: InvoiceItem) => {
    setPayTarget(invoice);
    setPayForm({ amount: String(invoice.amount), paid_date: today() });
    setPayError(null);
  };

  const handlePay = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!payTarget || paying) return;

    const invalid = amountError(payForm.amount);
    if (invalid) {
      setPayError(invalid);
      return;
    }
    const value = parseAmount(payForm.amount);
    if (value > payTarget.amount) {
      setPayError(`Nominal melebihi sisa tagihan (${formatRupiah(payTarget.amount)}).`);
      return;
    }
    if (value < payTarget.amount) {
      setPayError(
        `Pembayaran parsial belum didukung skema database. Sisa tagihan ${formatRupiah(
          payTarget.amount,
        )}; catat pembayaran penuh.`,
      );
      return;
    }

    setPaying(true);
    setPayError(null);
    try {
      await api.post(`/api/invoices/${payTarget.id}/pay`, {
        amount: value,
        paid_date: payForm.paid_date,
      });
      setToast({ type: 'success', text: `Pembayaran ${payTarget.invoice_number} tercatat lunas.` });
      setPayTarget(null);
      setDetail(null);
      await load();
    } catch (error) {
      setPayError(readError(error, 'Gagal mencatat pembayaran.'));
    } finally {
      setPaying(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmTarget || deleting) return;
    setDeleting(true);
    try {
      await api.delete(`/api/invoices/${confirmTarget.id}`);
      setToast({ type: 'success', text: `Tagihan ${confirmTarget.invoice_number} dihapus.` });
      setConfirmTarget(null);
      setDetail(null);
      await load();
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menghapus tagihan.') });
      setConfirmTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100';

  const summaryCards = summary
    ? [
        { label: 'Total tagihan', value: formatRupiah(summary.total), tone: 'text-white' },
        { label: 'Lunas', value: `${summary.paid}`, tone: 'text-emerald-400' },
        { label: 'Belum bayar', value: `${summary.unpaid}`, tone: 'text-amber-400' },
        { label: 'Terlambat', value: `${summary.overdue}`, tone: 'text-red-400' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tagihan</h1>
          <p className="text-slate-400 text-sm mt-1">Kelola tagihan bulanan dan pencatatan pembayaran</p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Buat Tagihan
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

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
              <p className="text-xs text-slate-400">{card.label}</p>
              <p className={`mt-1 text-lg font-bold ${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['all', 'unpaid', 'overdue', 'paid'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === key
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-slate-200'
            }`}
          >
            {key === 'all' ? 'Semua' : STATUS_LABEL[key]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-800/50 border border-slate-700/50 animate-pulse" />
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
      ) : visible.length === 0 ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-10 text-center space-y-2">
          <p className="text-slate-300 font-medium">
            {invoices.length === 0 ? 'Belum ada tagihan' : 'Tidak ada tagihan pada filter ini'}
          </p>
          <p className="text-sm text-slate-500">
            {invoices.length === 0
              ? canWrite
                ? 'Buat tagihan pertama untuk pelanggan Anda.'
                : 'Belum ada tagihan yang tercatat.'
              : 'Pilih filter lain untuk melihat tagihan.'}
          </p>
        </div>
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/30">
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Nomor</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Pelanggan</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Jumlah</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Jatuh Tempo</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Dibayar</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {visible.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-700/20 transition">
                    <td className="px-4 py-3 font-medium text-cyan-400 whitespace-nowrap">
                      {invoice.invoice_number}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{invoice.customer_name}</td>
                    <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                      {formatRupiah(invoice.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[invoice.status]}`}>
                        {STATUS_LABEL[invoice.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(invoice.due_date)}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(invoice.paid_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setDetail(invoice)}
                          className="text-slate-400 hover:text-cyan-400 transition"
                        >
                          Detail
                        </button>
                        {canWrite && invoice.status !== 'paid' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openPay(invoice)}
                              className="text-slate-400 hover:text-emerald-400 transition"
                            >
                              Bayar
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(invoice)}
                              className="text-slate-400 hover:text-cyan-400 transition"
                            >
                              Edit
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(invoice)}
                            className="text-slate-400 hover:text-red-400 transition"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-700/30 text-sm text-slate-400">
            Menampilkan {visible.length} dari {invoices.length} tagihan
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-modal-title"
            className="w-full sm:max-w-lg bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 id="invoice-modal-title" className="text-lg font-semibold text-white">
                  {editing ? `Ubah ${editing.invoice_number}` : 'Buat Tagihan'}
                </h2>
                <button
                  type="button"
                  onClick={closeForm}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition"
                  aria-label="Tutup"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {!editing && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-customer">
                    Pelanggan *
                  </label>
                  <select
                    id="i-customer"
                    value={form.customer_id}
                    onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                    className={inputClass}
                    required
                  >
                    <option value="">Pilih pelanggan</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-amount">
                    Nominal (Rp) *
                  </label>
                  <input
                    id="i-amount"
                    type="text"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className={inputClass}
                    placeholder="29700.50"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">Maksimal 2 angka desimal.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-due">
                    Jatuh tempo *
                  </label>
                  <input
                    id="i-due"
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-desc">
                  Deskripsi
                </label>
                <input
                  id="i-desc"
                  type="text"
                  maxLength={255}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={inputClass}
                  placeholder="Tagihan bulan Oktober"
                />
              </div>

              {formError && (
                <p role="alert" className="text-sm text-red-400">
                  {formError}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeForm}
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

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-detail-title"
            className="w-full sm:max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="invoice-detail-title" className="text-lg font-semibold text-white">
                  {detail.invoice_number}
                </h2>
                <p className="text-sm text-slate-400 mt-1">{detail.customer_name}</p>
              </div>
              <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[detail.status]}`}>
                {STATUS_LABEL[detail.status]}
              </span>
            </div>

            <dl className="text-sm space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Nominal</dt>
                <dd className="text-white font-medium">{formatRupiah(detail.amount)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Jatuh tempo</dt>
                <dd className="text-slate-200">{formatDate(detail.due_date)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Tanggal bayar</dt>
                <dd className="text-slate-200">{formatDate(detail.paid_date)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Deskripsi</dt>
                <dd className="text-slate-200 text-right break-words">{detail.description || '-'}</dd>
              </div>
            </dl>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 transition"
              >
                Tutup
              </button>
              {canWrite && detail.status !== 'paid' && (
                <button
                  type="button"
                  onClick={() => openPay(detail)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-400 transition"
                >
                  Catat Pembayaran
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-pay-title"
            className="w-full sm:max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <form onSubmit={handlePay} className="p-5 space-y-4">
              <h2 id="invoice-pay-title" className="text-lg font-semibold text-white">
                Pembayaran {payTarget.invoice_number}
              </h2>
              <p className="text-sm text-slate-400">
                Sisa tagihan <span className="text-white font-medium">{formatRupiah(payTarget.amount)}</span>
              </p>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-amount">
                  Nominal dibayar (Rp) *
                </label>
                <input
                  id="p-amount"
                  type="text"
                  inputMode="decimal"
                  value={payForm.amount}
                  onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-date">
                  Tanggal bayar *
                </label>
                <input
                  id="p-date"
                  type="date"
                  max={today()}
                  value={payForm.paid_date}
                  onChange={(e) => setPayForm((f) => ({ ...f, paid_date: e.target.value }))}
                  className={inputClass}
                  required
                />
              </div>

              {payError && (
                <p role="alert" className="text-sm text-red-400">
                  {payError}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (paying) return;
                    setPayTarget(null);
                    setPayError(null);
                  }}
                  disabled={paying}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 transition"
                >
                  {paying ? 'Menyimpan...' : 'Tandai Lunas'}
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
            aria-labelledby="confirm-invoice-title"
            className="w-full max-w-sm bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <h2 id="confirm-invoice-title" className="text-lg font-semibold text-white">
              Hapus tagihan?
            </h2>
            <p className="text-sm text-slate-400">
              Tagihan <span className="text-slate-200 font-medium">{confirmTarget.invoice_number}</span> (
              {formatRupiah(confirmTarget.amount)}) akan dihapus permanen.
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

export default Invoices;
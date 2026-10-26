import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadCsv } from '../utils/csv';

interface PaymentItem {
  id: number;
  invoice_id: number;
  invoice_number: string;
  customer_name: string;
  invoice_status: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paid_at: string;
  recorded_by_name: string | null;
  note: string;
  voided_at: string | null;
  void_reason: string | null;
}

type PaymentMethod = 'cash' | 'transfer' | 'qris' | 'other';

interface Summary {
  income: number;
  transactions: number;
  outstanding: number;
  overdue: number;
}

interface PayableInvoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  paid_total: number;
  remaining: number;
  due_date: string;
  overdue: boolean;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS / E-Wallet',
  other: 'Gateway / Lainnya',
};

const STATUS_LABEL: Record<string, string> = {
  paid: 'Lunas',
  unpaid: 'Belum bayar',
  partial: 'Sebagian',
  overdue: 'Terlambat',
};

const formatRupiah = (value: number): string =>
  `Rp ${Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;

const formatDate = (iso: string | null): string => {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
};

const monthStart = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
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

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100 text-sm';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const Payments: React.FC = () => {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'operator';
  const canVoid = user?.role === 'admin';

  const [period, setPeriod] = useState({ from: monthStart(), to: today() });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<PaymentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<'' | PaymentMethod>('');
  const [status, setStatus] = useState<'all' | 'valid' | 'void'>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoices, setInvoices] = useState<PayableInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [form, setForm] = useState({
    amount: '',
    paid_date: today(),
    method: 'cash' as PaymentMethod,
    reference: '',
    note: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const [detail, setDetail] = useState<PaymentItem | null>(null);
  const [voidTarget, setVoidTarget] = useState<PaymentItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === invoiceId) ?? null,
    [invoices, invoiceId],
  );

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.get('/api/payments/summary', {
        params: { from: period.from, to: period.to },
      });
      setSummary(res.data);
    } catch (error) {
      setSummary(null);
      throw error;
    }
  }, [period.from, period.to]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list] = await Promise.all([
        api.get('/api/payments', {
          params: {
            search: search.trim() || undefined,
            from: period.from || undefined,
            to: period.to || undefined,
            method: method || undefined,
            status,
            page,
            limit,
          },
        }),
        loadSummary(),
      ]);
      setRows(Array.isArray(list.data?.rows) ? list.data.rows : []);
      setTotal(Number(list.data?.total ?? 0));
    } catch (error) {
      setRows([]);
      setTotal(0);
      setLoadError(
        readError(
          error,
          'Gagal memuat data pembayaran. Periksa koneksi ke server atau status migrasi 001_payments.sql.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [search, period.from, period.to, method, status, page, limit, loadSummary]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!formOpen) return;
    let active = true;
    setInvoicesLoading(true);
    api
      .get('/api/payments/payable-invoices', { params: { search: invoiceSearch.trim() || undefined, limit: 50 } })
      .then((res) => {
        if (active) setInvoices(Array.isArray(res.data?.rows) ? res.data.rows : []);
      })
      .catch((error) => {
        if (active) setFormError(readError(error, 'Gagal memuat daftar tagihan.'));
      })
      .finally(() => {
        if (active) setInvoicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [formOpen, invoiceSearch]);

  const openForm = () => {
    setFormOpen(true);
    setInvoiceId(null);
    setInvoiceSearch('');
    setForm({ amount: '', paid_date: today(), method: 'cash', reference: '', note: '' });
    setFormError(null);
    setIdempotencyKey(newKey());
  };

  const pickInvoice = (invoice: PayableInvoice) => {
    setInvoiceId(invoice.id);
    setForm((f) => ({ ...f, amount: String(invoice.remaining) }));
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!selectedInvoice) {
      setFormError('Pilih tagihan lebih dulu.');
      return;
    }
    const invalid = amountError(form.amount);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    const value = parseAmount(form.amount);
    if (value > selectedInvoice.remaining) {
      setFormError(`Nominal melebihi sisa tagihan (${formatRupiah(selectedInvoice.remaining)}).`);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await api.post('/api/payments', {
        invoice_id: selectedInvoice.id,
        amount: value,
        method: form.method,
        paid_date: form.paid_date,
        reference: form.reference.trim() || undefined,
        note: form.note.trim() || undefined,
        idempotency_key: idempotencyKey,
      });
      setToast({
        type: 'success',
        text: `Pembayaran ${formatRupiah(value)} untuk ${selectedInvoice.invoice_number} tercatat.`,
      });
      setFormOpen(false);
      await loadRows();
    } catch (error) {
      setFormError(readError(error, 'Gagal mencatat pembayaran.'));
    } finally {
      setSaving(false);
    }
  };

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!voidTarget || voiding) return;
    if (voidReason.trim().length === 0) {
      setVoidError('Alasan pembatalan wajib diisi.');
      return;
    }
    setVoiding(true);
    setVoidError(null);
    try {
      await api.post(`/api/payments/${voidTarget.id}/void`, { reason: voidReason.trim() });
      setToast({ type: 'success', text: 'Transaksi dibatalkan (void), riwayat tetap tersimpan.' });
      setVoidTarget(null);
      setDetail(null);
      await loadRows();
    } catch (error) {
      setVoidError(readError(error, 'Gagal membatalkan transaksi.'));
    } finally {
      setVoiding(false);
    }
  };

  const exportCsv = async () => {
    try {
      const collected: PaymentItem[] = [];
      let current = 1;
      let expected = Number.POSITIVE_INFINITY;
      // Ambil semua baris sesuai filter (maks 5000) agar CSV bukan hanya halaman ini.
      while (collected.length < expected && collected.length < 5000) {
        const res = await api.get('/api/payments', {
          params: {
            search: search.trim() || undefined,
            from: period.from || undefined,
            to: period.to || undefined,
            method: method || undefined,
            status,
            page: current,
            limit: 200,
          },
        });
        expected = Number(res.data?.total ?? 0);
        const batch: PaymentItem[] = Array.isArray(res.data?.rows) ? res.data.rows : [];
        if (batch.length === 0) break;
        collected.push(...batch);
        current += 1;
      }

      downloadCsv(
        `pembayaran-${period.from || 'awal'}-${period.to || 'akhir'}.csv`,
        ['Tanggal', 'Invoice', 'Pelanggan', 'Metode', 'Nominal', 'Referensi', 'Petugas', 'Status', 'Alasan void', 'Catatan'],
        collected.map((row) => [
          row.paid_at,
          row.invoice_number,
          row.customer_name,
          METHOD_LABEL[row.method],
          row.amount,
          row.reference ?? '',
          row.recorded_by_name ?? '',
          row.voided_at ? 'void' : 'valid',
          row.void_reason ?? '',
          row.note,
        ]),
      );
      if (expected > collected.length) {
        setToast({
          type: 'error',
          text: `CSV dibatasi 5000 baris pertama dari ${expected} baris. Persempit filter periode.`,
        });
      }
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal mengekspor CSV.') });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const resetFilters = () => {
    setSearch('');
    setMethod('');
    setStatus('all');
    setPage(1);
    setPeriod({ from: monthStart(), to: today() });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pembayaran</h1>
          <p className="text-slate-400 text-sm mt-1">
            Riwayat transaksi dan pencatatan pembayaran tagihan
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportCsv()}
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 bg-slate-700/50 hover:bg-slate-700 transition"
          >
            Ekspor CSV
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={openForm}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 transition"
            >
              Catat Pembayaran
            </button>
          )}
        </div>
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

      {loadError ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center space-y-3">
          <p className="text-sm text-amber-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadRows()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: `Pemasukan ${formatDate(period.from)} – ${formatDate(period.to)}`, value: summary ? formatRupiah(summary.income) : '…' },
            { label: 'Transaksi valid', value: summary ? String(summary.transactions) : '…' },
            { label: 'Sisa tagihan (saat ini)', value: summary ? formatRupiah(summary.outstanding) : '…' },
            { label: 'Tunggakan jatuh tempo', value: summary ? formatRupiah(summary.overdue) : '…' },
          ].map((card) => (
            <div key={card.label} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
              <p className="text-xs text-slate-400">{card.label}</p>
              <p className="mt-1 text-lg font-bold text-white">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="block text-xs text-slate-400 mb-1" htmlFor="f-search">
              Cari (invoice / pelanggan / referensi)
            </label>
            <input
              id="f-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={inputClass}
              placeholder="INV-2026-0001 atau nama pelanggan"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1" htmlFor="f-from">
              Dari tanggal
            </label>
            <input
              id="f-from"
              type="date"
              value={period.from}
              onChange={(e) => {
                setPeriod((p) => ({ ...p, from: e.target.value }));
                setPage(1);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1" htmlFor="f-to">
              Sampai tanggal
            </label>
            <input
              id="f-to"
              type="date"
              value={period.to}
              onChange={(e) => {
                setPeriod((p) => ({ ...p, to: e.target.value }));
                setPage(1);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1" htmlFor="f-method">
              Metode
            </label>
            <select
              id="f-method"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as '' | PaymentMethod);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">Semua</option>
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((key) => (
                <option key={key} value={key}>
                  {METHOD_LABEL[key]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1" htmlFor="f-status">
              Status
            </label>
            <select
              id="f-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as 'all' | 'valid' | 'void');
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="all">Semua</option>
              <option value="valid">Valid</option>
              <option value="void">Void</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-slate-400 hover:text-slate-200 transition"
          >
            Reset filter
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-800/50 border border-slate-700/50 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 && !loadError ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-10 text-center">
          <p className="text-slate-300 font-medium">Tidak ada transaksi pada filter ini</p>
          <p className="text-sm text-slate-500 mt-1">
            Ubah periode/filter, atau catat pembayaran baru.
          </p>
        </div>
      ) : (
        !loadError && (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/30">
                    <th className="px-4 py-3 text-left font-medium text-slate-400">Tanggal</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-400">Invoice</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-400">Pelanggan</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-400">Metode</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-400">Nominal</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-400">Petugas</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-400">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-700/20 transition">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {formatDate(row.paid_at)}
                      </td>
                      <td className="px-4 py-3 text-cyan-400 whitespace-nowrap">{row.invoice_number}</td>
                      <td className="px-4 py-3 text-slate-300">{row.customer_name}</td>
                      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                        {METHOD_LABEL[row.method]}
                      </td>
                      <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                        {formatRupiah(row.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {row.recorded_by_name ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            row.voided_at
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {row.voided_at ? 'Void' : 'Valid'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setDetail(row)}
                            className="text-slate-400 hover:text-cyan-400 transition"
                          >
                            Detail
                          </button>
                          {canVoid && !row.voided_at && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidTarget(row);
                                setVoidReason('');
                                setVoidError(null);
                              }}
                              className="text-slate-400 hover:text-red-400 transition"
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-slate-700/30 text-sm text-slate-400">
              <span>
                Menampilkan {(page - 1) * limit + 1}–{Math.min(page * limit, total)} dari {total} transaksi
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
                >
                  Sebelumnya
                </button>
                <span className="text-xs">
                  Halaman {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-form-title"
            className="w-full sm:max-w-lg bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <form onSubmit={submitForm} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 id="payment-form-title" className="text-lg font-semibold text-white">
                  Catat Pembayaran
                </h2>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition"
                  aria-label="Tutup"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-invoice-search">
                  Tagihan yang masih bersisa *
                </label>
                <input
                  id="p-invoice-search"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  className={inputClass}
                  placeholder="Cari nomor invoice atau nama pelanggan"
                />
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-700/60 divide-y divide-slate-700/40">
                  {invoicesLoading ? (
                    <p className="px-3 py-2 text-xs text-slate-500">Memuat tagihan…</p>
                  ) : invoices.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">
                      Tidak ada tagihan bersisa pada pencarian ini.
                    </p>
                  ) : (
                    invoices.map((invoice) => (
                      <button
                        key={invoice.id}
                        type="button"
                        onClick={() => pickInvoice(invoice)}
                        className={`w-full text-left px-3 py-2 text-sm transition ${
                          invoiceId === invoice.id
                            ? 'bg-cyan-500/10 text-cyan-200'
                            : 'text-slate-300 hover:bg-slate-700/40'
                        }`}
                      >
                        <span className="font-medium">{invoice.invoice_number}</span> ·{' '}
                        {invoice.customer_name}
                        <span className="block text-xs text-slate-400">
                          sisa {formatRupiah(invoice.remaining)} · jatuh tempo{' '}
                          {formatDate(invoice.due_date)}
                          {invoice.overdue ? ' · terlambat' : ''}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-300 mb-1">Pelanggan</p>
                <p className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-700/60 text-sm text-slate-300">
                  {selectedInvoice ? selectedInvoice.customer_name : 'Pilih tagihan lebih dulu'}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-amount">
                    Nominal (Rp) *
                  </label>
                  <input
                    id="p-amount"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className={inputClass}
                    placeholder="400000"
                    required
                  />
                  {selectedInvoice && (
                    <p className="text-xs text-slate-500 mt-1">
                      Sisa: {formatRupiah(selectedInvoice.remaining)} (boleh sebagian)
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-date">
                    Tanggal bayar *
                  </label>
                  <input
                    id="p-date"
                    type="date"
                    max={today()}
                    value={form.paid_date}
                    onChange={(e) => setForm((f) => ({ ...f, paid_date: e.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-method">
                    Metode *
                  </label>
                  <select
                    id="p-method"
                    value={form.method}
                    onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))}
                    className={inputClass}
                  >
                    {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((key) => (
                      <option key={key} value={key}>
                        {METHOD_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-ref">
                    Referensi transaksi
                  </label>
                  <input
                    id="p-ref"
                    maxLength={64}
                    value={form.reference}
                    onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                    className={inputClass}
                    placeholder="No. transfer / bukti (opsional)"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-note">
                  Catatan
                </label>
                <input
                  id="p-note"
                  maxLength={255}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  className={inputClass}
                  placeholder="Opsional"
                />
              </div>

              {formError && (
                <p role="alert" className="text-sm text-red-400">
                  {formError}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedInvoice}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 transition"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Pembayaran'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-detail-title"
            className="w-full max-w-md bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="payment-detail-title" className="text-lg font-semibold text-white">
                  {formatRupiah(detail.amount)}
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  {detail.invoice_number} · {detail.customer_name}
                </p>
              </div>
              <span
                className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium ${
                  detail.voided_at ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
                }`}
              >
                {detail.voided_at ? 'Void' : 'Valid'}
              </span>
            </div>

            <dl className="text-sm space-y-2">
              {[
                ['Tanggal bayar', formatDate(detail.paid_at)],
                ['Metode', METHOD_LABEL[detail.method]],
                ['Referensi', detail.reference ?? '-'],
                ['Petugas', detail.recorded_by_name ?? '-'],
                ['Status tagihan', STATUS_LABEL[detail.invoice_status] ?? detail.invoice_status],
                ['Catatan', detail.note || '-'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="text-slate-200 text-right break-words">{value}</dd>
                </div>
              ))}
              {detail.voided_at && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Alasan void</dt>
                  <dd className="text-red-300 text-right break-words">{detail.void_reason ?? '-'}</dd>
                </div>
              )}
            </dl>

            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 transition"
              >
                Tutup
              </button>
              {canVoid && !detail.voided_at && (
                <button
                  type="button"
                  onClick={() => {
                    setVoidTarget(detail);
                    setVoidReason('');
                    setVoidError(null);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-400 transition"
                >
                  Void transaksi
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="void-payment-title"
            className="w-full max-w-sm bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <form onSubmit={submitVoid} className="space-y-4">
              <h2 id="void-payment-title" className="text-lg font-semibold text-white">
                Void transaksi?
              </h2>
              <p className="text-sm text-slate-400">
                Pembayaran {formatRupiah(voidTarget.amount)} pada {voidTarget.invoice_number} tidak
                dihapus — riwayat tetap ada dan status tagihan dihitung ulang.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="void-reason">
                  Alasan pembatalan *
                </label>
                <input
                  id="void-reason"
                  maxLength={255}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className={inputClass}
                  placeholder="Mis. transfer ganda"
                  required
                />
              </div>
              {voidError && (
                <p role="alert" className="text-sm text-red-400">
                  {voidError}
                </p>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setVoidTarget(null)}
                  disabled={voiding}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={voiding}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-400 disabled:opacity-50 transition"
                >
                  {voiding ? 'Membatalkan...' : 'Void'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payments;

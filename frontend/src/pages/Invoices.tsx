import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import { TablePager } from '../components/TablePager';
import { useAuth } from '../contexts/AuthContext';

interface InvoiceItem {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  /** Akun RADIUS yang ditagih; null untuk tagihan non-layanan. */
  username: string | null;
  amount: number;
  status: 'unpaid' | 'paid' | 'overdue' | 'partial' | 'void';
  due_date: string;
  /** Periode penagihan (migrasi 032); null untuk tagihan lama/non-layanan. */
  period_start: string | null;
  period_end: string | null;
  paid_date: string | null;
  description: string;
  /** Jejak pembatalan: tagihan void tidak dihapus, hanya ditandai. */
  voided_at: string | null;
  void_reason: string | null;
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

interface CustomerAccount {
  username: string;
  profile_type: 'hotspot' | 'ppp';
  profile_name: string;
  status: string;
}

interface InvoiceForm {
  customer_id: string;
  username: string;
  amount: string;
  due_date: string;
  period_start: string;
  period_end: string;
  description: string;
}

// Satu baris riwayat dari finance_events (append-only).
interface FinanceEventItem {
  id: number;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  reason: string | null;
  actor_name: string | null;
  created_at: string;
}

interface PaymentItem {
  id: number;
  invoice_id: number;
  amount: number;
  method: 'cash' | 'transfer' | 'qris' | 'other';
  reference: string | null;
  paid_at: string;
  recorded_by_name: string | null;
  note: string;
  voided_at: string | null;
  void_reason: string | null;
}

interface PayForm {
  amount: string;
  paid_date: string;
  method: PaymentItem['method'];
  reference: string;
  note: string;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

// Tanggal lokal (bukan UTC): toISOString() bisa mundur sehari di WIB.
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
};

const EMPTY_FORM: InvoiceForm = {
  customer_id: '',
  username: '',
  amount: '',
  due_date: today(),
  period_start: '',
  period_end: '',
  description: '',
};

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

// Timestamp jejak audit (ISO dari server) → tanggal + jam lokal.
const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const time = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(iso)} ${time}`;
};

const STATUS_LABEL: Record<InvoiceItem['status'], string> = {
  paid: 'Lunas',
  overdue: 'Terlambat',
  unpaid: 'Belum bayar',
  partial: 'Sebagian',
  void: 'Dibatalkan',
};

const ACTION_LABEL: Record<string, string> = {
  INVOICE_CREATED: 'Tagihan dibuat',
  INVOICE_UPDATED: 'Tagihan diubah',
  INVOICE_VOIDED: 'Tagihan dibatalkan',
  PAYMENT_CREATED: 'Pembayaran dicatat',
  PAYMENT_VOIDED: 'Pembayaran dibatalkan',
};

const periodLabel = (invoice: InvoiceItem): string => {
  if (!invoice.period_start && !invoice.period_end) return '-';
  return `${formatDate(invoice.period_start)} – ${formatDate(invoice.period_end)}`;
};

// Alasan void wajib, minimal 5 karakter (sama dengan validasi backend).
const voidReasonError = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'Alasan pembatalan wajib diisi.';
  if (trimmed.length < 5) return 'Alasan minimal 5 karakter agar bisa diaudit.';
  if (trimmed.length > 255) return 'Alasan maksimal 255 karakter.';
  return null;
};

const METHOD_LABEL: Record<PaymentItem['method'], string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  other: 'Lainnya',
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const sumValid = (list: PaymentItem[]): number =>
  round2(list.filter((p) => !p.voided_at).reduce((total, p) => total + p.amount, 0));

const STATUS_CLASS: Record<InvoiceItem['status'], string> = {
  paid: 'bg-emerald-500/10 text-emerald-400',
  overdue: 'bg-red-500/10 text-red-400',
  unpaid: 'bg-amber-500/10 text-amber-400',
  partial: 'bg-cyan-500/10 text-cyan-300',
  void: 'bg-slate-500/20 text-slate-400 line-through',
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
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceItem['status']>('all');
  // Fase 0: daftar diambil per halaman dari server (bukan ambil semua).
  // Jumlah baris per halaman dipilih operator; server membatasi maksimal 1000.
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceItem | null>(null);
  const [form, setForm] = useState<InvoiceForm>(EMPTY_FORM);
  // Akun RADIUS milik pelanggan yang dipilih di form.
  const [customerAccounts, setCustomerAccounts] = useState<CustomerAccount[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<InvoiceItem | null>(null);
  // Riwayat aktivitas tagihan (finance_events) untuk panel detail.
  const [events, setEvents] = useState<FinanceEventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [payTarget, setPayTarget] = useState<InvoiceItem | null>(null);
  const [payForm, setPayForm] = useState<PayForm>({
    amount: '',
    paid_date: today(),
    method: 'cash',
    reference: '',
    note: '',
  });
  const [payKey, setPayKey] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // Riwayat pembayaran invoice yang sedang dibuka (detail atau dialog bayar).
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  // Sebelum migrasi 001 dijalankan, endpoint riwayat menjawab 503. Pesannya
  // ditampilkan inline (bukan toast) agar panel tidak terlihat rusak.
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<PaymentItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  // Pembatalan tagihan (void) — pengganti hapus permanen.
  const [invoiceVoidTarget, setInvoiceVoidTarget] = useState<InvoiceItem | null>(null);
  const [invoiceVoidReason, setInvoiceVoidReason] = useState('');
  const [invoiceVoidError, setInvoiceVoidError] = useState<string | null>(null);
  const [invoiceVoiding, setInvoiceVoiding] = useState(false);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setLoadError(null);
    try {
      const [list, stats] = await Promise.all([
        api.get('/api/invoices', {
          params: {
            page,
            limit,
            status: statusFilter === 'all' ? undefined : statusFilter,
          },
        }),
        api.get('/api/invoices/summary'),
      ]);
      const data = list.data;
      if (Array.isArray(data)) {
        setInvoices(data);
        setTotal(data.length);
      } else {
        setInvoices(Array.isArray(data?.rows) ? data.rows : []);
        setTotal(Number(data?.total ?? 0));
      }
      setSummary(stats.data ?? null);
    } catch (error) {
      setInvoices([]);
      setTotal(0);
      setLoadError(readError(error, 'Gagal memuat tagihan. Periksa koneksi ke server.'));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

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
      username: invoice.username ?? '',
      amount: String(invoice.amount),
      due_date: invoice.due_date.slice(0, 10),
      period_start: invoice.period_start?.slice(0, 10) ?? '',
      period_end: invoice.period_end?.slice(0, 10) ?? '',
      description: invoice.description ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  // Daftar akun mengikuti pelanggan terpilih; tanpa pelanggan, daftarnya kosong.
  useEffect(() => {
    if (!formOpen || !form.customer_id) {
      setCustomerAccounts([]);
      return;
    }
    let alive = true;
    api
      .get<CustomerAccount[]>(`/api/customers/${form.customer_id}/accounts`)
      .then(({ data }) => {
        if (alive) setCustomerAccounts(data);
      })
      .catch(() => {
        if (alive) setCustomerAccounts([]);
      });
    return () => {
      alive = false;
    };
  }, [formOpen, form.customer_id]);

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
    // Periode: keduanya diisi atau keduanya kosong (sama dengan aturan backend).
    const periodStart = form.period_start.trim();
    const periodEnd = form.period_end.trim();
    if ((periodStart === '') !== (periodEnd === '')) {
      return 'Periode awal dan periode akhir harus diisi bersama.';
    }
    if (periodStart && periodEnd && periodEnd < periodStart) {
      return 'Periode akhir tidak boleh lebih awal dari periode awal.';
    }
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
          // null = kosongkan periode (dikirim berpasangan).
          period_start: form.period_start || null,
          period_end: form.period_end || null,
          description: form.description.trim(),
        });
        setToast({ type: 'success', text: 'Tagihan berhasil diperbarui.' });
      } else {
        await api.post('/api/invoices', {
          customer_id: Number(form.customer_id),
          // Akun RADIUS yang ditagih: pembayaran lunas akan mengaktifkannya.
          username: form.username || null,
          amount: parseAmount(form.amount),
          due_date: form.due_date,
          period_start: form.period_start || null,
          period_end: form.period_end || null,
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

  const loadPayments = async (invoiceId: number): Promise<PaymentItem[]> => {
    setPaymentsLoading(true);
    try {
      const res = await api.get(`/api/invoices/${invoiceId}/payments`);
      const list: PaymentItem[] = Array.isArray(res.data) ? res.data : [];
      setPayments(list);
      return list;
    } catch (error) {
      setPayments([]);
      throw error;
    } finally {
      setPaymentsLoading(false);
    }
  };

  const loadEvents = async (invoiceId: number): Promise<void> => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await api.get(`/api/invoices/${invoiceId}/events`);
      setEvents(Array.isArray(res.data) ? (res.data as FinanceEventItem[]) : []);
    } catch (error) {
      setEvents([]);
      // 503 = migrasi 032 belum dijalankan; ditampilkan inline, bukan toast.
      setEventsError(readError(error, 'Riwayat aktivitas belum dapat dimuat.'));
    } finally {
      setEventsLoading(false);
    }
  };

  const openDetail = async (invoice: InvoiceItem) => {
    setDetail(invoice);
    setPayments([]);
    setPaymentsError(null);
    setEvents([]);
    setEventsError(null);
    try {
      await loadPayments(invoice.id);
    } catch (error) {
      setPaymentsError(readError(error, 'Gagal memuat riwayat pembayaran.'));
    }
    await loadEvents(invoice.id);
  };

  // Kunci idempoten per dialog: klik ganda tidak boleh menjadi dua tagihan.
  const newPayKey = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const openPay = async (invoice: InvoiceItem) => {
    setPayTarget(invoice);
    setPayError(null);
    setPayKey(newPayKey());
    setPayForm({ amount: '', paid_date: today(), method: 'cash', reference: '', note: '' });
    setPayments([]);
    try {
      const list = await loadPayments(invoice.id);
      const sisa = round2(invoice.amount - sumValid(list));
      setPayForm((f) => ({ ...f, amount: sisa > 0 ? String(sisa) : '' }));
    } catch (error) {
      setPayError(readError(error, 'Gagal memuat sisa tagihan.'));
    }
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
    const sisa = round2(payTarget.amount - sumValid(payments));
    if (sisa <= 0) {
      setPayError('Tagihan ini sudah lunas, tidak ada sisa yang bisa dibayar.');
      return;
    }
    if (value > sisa) {
      setPayError(`Nominal melebihi sisa tagihan (${formatRupiah(sisa)}).`);
      return;
    }

    setPaying(true);
    setPayError(null);
    try {
      const res = await api.post(`/api/invoices/${payTarget.id}/payments`, {
        amount: value,
        method: payForm.method,
        paid_date: payForm.paid_date,
        reference: payForm.reference.trim() || undefined,
        note: payForm.note.trim() || undefined,
        idempotency_key: payKey,
      });
      const status = res.data?.invoice?.status as InvoiceItem['status'] | undefined;
      setToast({
        type: 'success',
        text:
          status === 'paid'
            ? `Pembayaran ${payTarget.invoice_number} tercatat lunas.`
            : `Pembayaran parsial ${formatRupiah(value)} tercatat; sisa ${formatRupiah(
                round2(sisa - value),
              )}.`,
      });
      setDetail((d) =>
        d && d.id === payTarget.id
          ? { ...d, status: status ?? d.status, paid_date: res.data?.invoice?.paid_date ?? d.paid_date }
          : d,
      );
      setPayTarget(null);
      await load();
      if (detail?.id === payTarget.id) {
        await loadPayments(payTarget.id).catch(() => undefined);
        await loadEvents(payTarget.id);
      }
    } catch (error) {
      setPayError(readError(error, 'Gagal mencatat pembayaran.'));
    } finally {
      setPaying(false);
    }
  };

  const openVoid = (payment: PaymentItem) => {
    setVoidTarget(payment);
    setVoidReason('');
    setVoidError(null);
  };

  const handleVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!voidTarget || voiding) return;
    if (voidReason.trim().length === 0) {
      setVoidError('Alasan void wajib diisi.');
      return;
    }

    setVoiding(true);
    setVoidError(null);
    try {
      const res = await api.post(`/api/payments/${voidTarget.id}/void`, {
        reason: voidReason.trim(),
      });
      setToast({
        type: 'success',
        text: `Pembayaran ${formatRupiah(voidTarget.amount)} dibatalkan (void).`,
      });
      const invoiceId = voidTarget.invoice_id;
      setVoidTarget(null);
      setDetail((d) =>
        d && d.id === invoiceId
          ? {
              ...d,
              status: (res.data?.invoice?.status as InvoiceItem['status']) ?? d.status,
              paid_date: res.data?.invoice?.paid_date ?? null,
            }
          : d,
      );
      await load();
      await loadPayments(invoiceId).catch(() => undefined);
      if (detail?.id === invoiceId) await loadEvents(invoiceId);
    } catch (error) {
      setVoidError(readError(error, 'Gagal membatalkan pembayaran.'));
    } finally {
      setVoiding(false);
    }
  };

  const openInvoiceVoid = (invoice: InvoiceItem) => {
    setInvoiceVoidTarget(invoice);
    setInvoiceVoidReason('');
    setInvoiceVoidError(null);
  };

  // Tagihan tidak pernah dihapus: dibatalkan dengan alasan yang tercatat.
  const handleInvoiceVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invoiceVoidTarget || invoiceVoiding) return;
    const invalid = voidReasonError(invoiceVoidReason);
    if (invalid) {
      setInvoiceVoidError(invalid);
      return;
    }

    setInvoiceVoiding(true);
    setInvoiceVoidError(null);
    try {
      const res = await api.post(`/api/invoices/${invoiceVoidTarget.id}/void`, {
        reason: invoiceVoidReason.trim(),
      });
      const updated = res.data as InvoiceItem;
      const targetId = invoiceVoidTarget.id;
      setToast({
        type: 'success',
        text: `Tagihan ${invoiceVoidTarget.invoice_number} dibatalkan (void).`,
      });
      setInvoiceVoidTarget(null);
      setDetail((d) => (d && d.id === targetId ? { ...d, ...updated } : d));
      await load();
      if (detail?.id === targetId) await loadEvents(targetId);
    } catch (error) {
      setInvoiceVoidError(readError(error, 'Gagal membatalkan tagihan.'));
    } finally {
      setInvoiceVoiding(false);
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
        {(['all', 'unpaid', 'overdue', 'partial', 'paid', 'void'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStatusFilter(key);
              setPage(1);
            }}
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
      ) : invoices.length === 0 ? (
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
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Akun RADIUS</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Jumlah</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Jatuh Tempo</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Periode</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Dibayar</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className={`transition hover:bg-slate-700/20 ${
                      invoice.status === 'void' ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-cyan-400 whitespace-nowrap">
                      {invoice.invoice_number}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{invoice.customer_name}</td>
                    <td className="px-4 py-3">
                      {invoice.username ? (
                        <span className="font-mono text-xs text-slate-200">{invoice.username}</span>
                      ) : (
                        <span className="text-[11px] text-slate-500">tanpa akun</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                      {formatRupiah(invoice.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[invoice.status]}`}>
                        {STATUS_LABEL[invoice.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(invoice.due_date)}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                      {periodLabel(invoice)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(invoice.paid_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => void openDetail(invoice)}
                          className="text-slate-400 hover:text-cyan-400 transition"
                        >
                          Detail
                        </button>
                        {canWrite && invoice.status !== 'paid' && invoice.status !== 'void' && (
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
                        {canWrite && invoice.status !== 'void' && (
                          <button
                            type="button"
                            onClick={() => openInvoiceVoid(invoice)}
                            className="text-slate-400 hover:text-red-400 transition"
                          >
                            Batalkan
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager
            page={page}
            size={limit}
            total={total}
            unit="tagihan"
            loading={loading}
            onPage={setPage}
            onSize={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
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
                    onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value, username: '' }))}
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

              {!editing && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-username">
                    Akun RADIUS (opsional)
                  </label>
                  <select
                    id="i-username"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Tanpa akun (tagihan non-layanan)</option>
                    {customerAccounts.map((a) => (
                      <option key={a.username} value={a.username}>
                        {a.username} · {a.profile_type}/{a.profile_name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    {form.customer_id === ''
                      ? 'Pilih pelanggan lebih dulu untuk melihat akunnya.'
                      : customerAccounts.length === 0
                        ? 'Pelanggan ini belum punya akun RADIUS.'
                        : 'Bila tagihan lunas, akun ini diaktifkan otomatis.'}
                  </p>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-period-start">
                    Periode awal
                  </label>
                  <input
                    id="i-period-start"
                    type="date"
                    value={form.period_start}
                    onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="i-period-end">
                    Periode akhir
                  </label>
                  <input
                    id="i-period-end"
                    type="date"
                    min={form.period_start || undefined}
                    value={form.period_end}
                    onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 -mt-2">
                Isi keduanya atau kosongkan keduanya. Periode yang sama untuk akun yang sama
                tidak bisa ditagih dua kali — batalkan (void) tagihan lama bila memang diganti.
              </p>

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
                <dt className="text-slate-400">Terbayar</dt>
                <dd className="text-emerald-300">{formatRupiah(sumValid(payments))}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Sisa</dt>
                <dd className="text-white font-medium">
                  {formatRupiah(round2(detail.amount - sumValid(payments)))}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Jatuh tempo</dt>
                <dd className="text-slate-200">{formatDate(detail.due_date)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Periode</dt>
                <dd className="text-slate-200 text-right">{periodLabel(detail)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Tanggal bayar</dt>
                <dd className="text-slate-200">{formatDate(detail.paid_date)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Deskripsi</dt>
                <dd className="text-slate-200 text-right break-words">{detail.description || '-'}</dd>
              </div>
              {detail.status === 'void' && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Dibatalkan</dt>
                  <dd className="text-red-400 text-right break-words">
                    {formatDateTime(detail.voided_at ?? '')}
                    {detail.void_reason ? ` · ${detail.void_reason}` : ''}
                  </dd>
                </div>
              )}
            </dl>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300">Riwayat pembayaran</p>
              {paymentsLoading ? (
                <p className="text-sm text-slate-500">Memuat riwayat...</p>
              ) : paymentsError ? (
                <p className="text-sm text-amber-400">{paymentsError}</p>
              ) : payments.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada pembayaran tercatat.</p>
              ) : (
                <ul className="space-y-2">
                  {payments.map((payment) => (
                    <li
                      key={payment.id}
                      className={`rounded-lg border px-3 py-2 ${
                        payment.voided_at
                          ? 'border-slate-700/40 bg-slate-800/40'
                          : 'border-slate-700/50 bg-slate-700/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium ${
                              payment.voided_at ? 'text-slate-500 line-through' : 'text-white'
                            }`}
                          >
                            {formatRupiah(payment.amount)}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatDate(payment.paid_at.slice(0, 10))} · {METHOD_LABEL[payment.method]}
                            {payment.reference ? ` · ${payment.reference}` : ''}
                            {payment.recorded_by_name ? ` · oleh ${payment.recorded_by_name}` : ''}
                          </p>
                          {payment.voided_at ? (
                            <p className="text-xs text-red-400 mt-1">Void: {payment.void_reason}</p>
                          ) : payment.note ? (
                            <p className="text-xs text-slate-500 mt-1 break-words">{payment.note}</p>
                          ) : null}
                        </div>
                        {canDelete && !payment.voided_at && (
                          <button
                            type="button"
                            onClick={() => openVoid(payment)}
                            className="shrink-0 text-xs text-slate-400 hover:text-red-400 transition"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300">Riwayat aktivitas</p>
              {eventsLoading ? (
                <p className="text-sm text-slate-500">Memuat riwayat...</p>
              ) : eventsError ? (
                <p className="text-sm text-amber-400">{eventsError}</p>
              ) : events.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada aktivitas tercatat.</p>
              ) : (
                <ul className="space-y-1.5">
                  {events.map((event) => (
                    <li key={event.id} className="rounded-lg border border-slate-700/50 bg-slate-700/10 px-3 py-2">
                      <p className="text-sm text-slate-200">
                        {ACTION_LABEL[event.action] ?? event.action}
                        {typeof event.after_json?.amount === 'number' && event.action !== 'INVOICE_UPDATED'
                          ? ` · ${formatRupiah(event.after_json.amount as number)}`
                          : ''}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatDateTime(event.created_at)}
                        {event.actor_name ? ` · ${event.actor_name}` : ''}
                      </p>
                      {event.reason && <p className="text-xs text-red-400 mt-1 break-words">{event.reason}</p>}
                      {event.action === 'INVOICE_UPDATED' &&
                        typeof event.before_json?.amount === 'number' &&
                        typeof event.after_json?.amount === 'number' &&
                        event.before_json.amount !== event.after_json.amount && (
                          <p className="text-xs text-slate-400 mt-1">
                            Nominal {formatRupiah(event.before_json.amount as number)} →{' '}
                            {formatRupiah(event.after_json.amount as number)}
                          </p>
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 transition"
              >
                Tutup
              </button>
              {canWrite && detail.status !== 'paid' && detail.status !== 'void' && (
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
                Sisa tagihan{' '}
                <span className="text-white font-medium">
                  {formatRupiah(round2(payTarget.amount - sumValid(payments)))}
                </span>
                {sumValid(payments) > 0 && (
                  <span className="text-slate-500">
                    {' '}
                    (terbayar {formatRupiah(sumValid(payments))})
                  </span>
                )}
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

              <div className="grid gap-4 sm:grid-cols-2">
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
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-method">
                    Metode *
                  </label>
                  <select
                    id="p-method"
                    value={payForm.method}
                    onChange={(e) =>
                      setPayForm((f) => ({ ...f, method: e.target.value as PaymentItem['method'] }))
                    }
                    className={inputClass}
                  >
                    {(Object.keys(METHOD_LABEL) as PaymentItem['method'][]).map((key) => (
                      <option key={key} value={key}>
                        {METHOD_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-ref">
                    Referensi
                  </label>
                  <input
                    id="p-ref"
                    type="text"
                    maxLength={64}
                    value={payForm.reference}
                    onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                    className={inputClass}
                    placeholder="No. transfer / bukti"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="p-note">
                    Catatan
                  </label>
                  <input
                    id="p-note"
                    type="text"
                    maxLength={255}
                    value={payForm.note}
                    onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))}
                    className={inputClass}
                    placeholder="Opsional"
                  />
                </div>
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
                  {paying ? 'Menyimpan...' : 'Simpan Pembayaran'}
                </button>
              </div>
            </form>
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
            <form onSubmit={handleVoid} className="space-y-4">
              <h2 id="void-payment-title" className="text-lg font-semibold text-white">
                Void pembayaran?
              </h2>
              <p className="text-sm text-slate-400">
                Pembayaran <span className="text-slate-200 font-medium">{formatRupiah(voidTarget.amount)}</span>{' '}
                tidak dihapus, hanya dibatalkan dan tetap tersimpan di riwayat. Status tagihan
                dihitung ulang dari pembayaran yang sah.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="void-reason">
                  Alasan void *
                </label>
                <input
                  id="void-reason"
                  type="text"
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
                  onClick={() => {
                    if (voiding) return;
                    setVoidTarget(null);
                    setVoidError(null);
                  }}
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

      {invoiceVoidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="void-invoice-title"
            className="w-full max-w-sm bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <form onSubmit={handleInvoiceVoid} className="space-y-4">
              <h2 id="void-invoice-title" className="text-lg font-semibold text-white">
                Batalkan tagihan?
              </h2>
              <p className="text-sm text-slate-400">
                Tagihan{' '}
                <span className="text-slate-200 font-medium">{invoiceVoidTarget.invoice_number}</span> (
                {formatRupiah(invoiceVoidTarget.amount)}) tidak dihapus, hanya dibatalkan. Nomor tagihan,
                riwayat pembayaran, dan alasannya tetap tersimpan.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="void-invoice-reason">
                  Alasan pembatalan *
                </label>
                <input
                  id="void-invoice-reason"
                  type="text"
                  maxLength={255}
                  value={invoiceVoidReason}
                  onChange={(e) => setInvoiceVoidReason(e.target.value)}
                  className={inputClass}
                  placeholder="Mis. salah input nominal"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Minimal 5 karakter.</p>
              </div>
              {invoiceVoidError && (
                <p role="alert" className="text-sm text-red-400">
                  {invoiceVoidError}
                </p>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (invoiceVoiding) return;
                    setInvoiceVoidTarget(null);
                    setInvoiceVoidError(null);
                  }}
                  disabled={invoiceVoiding}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={invoiceVoiding}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-400 disabled:opacity-50 transition"
                >
                  {invoiceVoiding ? 'Membatalkan...' : 'Batalkan Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Invoices;
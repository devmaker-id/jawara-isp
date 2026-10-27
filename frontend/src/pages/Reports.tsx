import React, { useCallback, useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import { downloadCsv } from '../utils/csv';

type ReportType = 'summary' | 'transactions' | 'unpaid' | 'by-method';
type PaymentMethod = 'cash' | 'transfer' | 'qris' | 'other';

interface ReportSummary {
  income: number;
  transactions: number;
  outstanding: number;
  overdue: number;
}

interface PaymentRow {
  id: number;
  invoice_number: string;
  customer_name: string;
  invoice_status: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paid_at: string;
  recorded_by_name: string | null;
  voided_at: string | null;
}

interface InvoiceRow {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  paid_total: number;
  remaining: number;
  due_date: string;
  overdue: boolean;
}

interface MethodRow {
  method: PaymentMethod;
  transactions: number;
  total: number;
}

interface ReportResult {
  type: ReportType;
  summary: ReportSummary;
  rows: Array<PaymentRow | InvoiceRow>;
  by_method: MethodRow[];
  total: number;
  page: number;
  limit: number;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS / E-Wallet',
  other: 'Gateway / Lainnya',
};

const TYPE_LABEL: Record<ReportType, string> = {
  summary: 'Ringkasan keuangan',
  transactions: 'Detail transaksi',
  unpaid: 'Tagihan belum lunas / jatuh tempo',
  'by-method': 'Pemasukan per metode',
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

interface ContributionRow {
  user_id: number;
  name: string;
  role: string;
  customers: number;
  vouchers: number;
  hotspot_profiles: number;
  ppp_profiles: number;
  group_profiles: number;
  total: number;
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100 text-sm';

const Reports: React.FC = () => {
  const [type, setType] = useState<ReportType>('summary');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [method, setMethod] = useState<'' | PaymentMethod>('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Kontribusi per akun: berapa pelanggan/voucher/profil yang DIBUAT siapa.
  const [contrib, setContrib] = useState<ContributionRow[]>([]);
  const [contribLoading, setContribLoading] = useState(true);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setLoadError(null);
    try {
      const res = await api.get('/api/reports', {
        params: {
          type,
          from: from || undefined,
          to: to || undefined,
          method: method || undefined,
          page,
          limit,
        },
      });
      setResult(res.data);
    } catch (error) {
      setResult(null);
      setLoadError(
        readError(
          error,
          'Gagal memuat laporan. Bila tabel payments belum ada, migrasi 001_payments.sql belum dijalankan.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [type, from, to, method, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 120000 });

  // Kontribusi memakai periode yang sama; kegagalannya tidak boleh
  // menggagalkan laporan keuangan, jadi ditangani terpisah.
  useEffect(() => {
    let alive = true;
    setContribLoading(true);
    api
      .get('/api/reports/contributions', { params: { from: from || undefined, to: to || undefined } })
      .then((res) => {
        if (alive) setContrib(Array.isArray(res.data?.rows) ? res.data.rows : []);
      })
      .catch(() => {
        if (alive) setContrib([]);
      })
      .finally(() => {
        if (alive) setContribLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  const changeType = (next: ReportType) => {
    setType(next);
    setPage(1);
  };

  const exportCsv = () => {
    if (!result) return;
    const suffix = `${type}-${from || 'awal'}-${to || 'akhir'}`;

    if (type === 'by-method') {
      downloadCsv(
        `laporan-${suffix}.csv`,
        ['Metode', 'Jumlah transaksi', 'Total'],
        result.by_method.map((row) => [METHOD_LABEL[row.method], row.transactions, row.total]),
      );
      return;
    }
    if (type === 'unpaid') {
      downloadCsv(
        `laporan-${suffix}.csv`,
        ['Invoice', 'Pelanggan', 'Nominal', 'Terbayar', 'Sisa', 'Jatuh tempo', 'Terlambat'],
        (result.rows as InvoiceRow[]).map((row) => [
          row.invoice_number,
          row.customer_name,
          row.amount,
          row.paid_total,
          row.remaining,
          row.due_date,
          row.overdue ? 'ya' : 'tidak',
        ]),
      );
      return;
    }
    if (type === 'transactions') {
      downloadCsv(
        `laporan-${suffix}.csv`,
        ['Tanggal', 'Invoice', 'Pelanggan', 'Metode', 'Nominal', 'Referensi', 'Petugas', 'Status'],
        (result.rows as PaymentRow[]).map((row) => [
          row.paid_at,
          row.invoice_number,
          row.customer_name,
          METHOD_LABEL[row.method],
          row.amount,
          row.reference ?? '',
          row.recorded_by_name ?? '',
          row.voided_at ? 'void' : 'valid',
        ]),
      );
      return;
    }

    downloadCsv(
      `laporan-${suffix}.csv`,
      ['Periode dari', 'Periode sampai', 'Pemasukan valid', 'Transaksi valid', 'Sisa tagihan', 'Tunggakan jatuh tempo'],
      [[from, to, result.summary.income, result.summary.transactions, result.summary.outstanding, result.summary.overdue]],
    );
  };

  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / limit));

  const renderTable = () => {
    if (!result) return null;

    if (type === 'summary') {
      return (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 space-y-2 text-sm text-slate-400">
          <p>
            Ringkasan dihitung dari query database: pemasukan hanya dari pembayaran sah (void tidak
            dihitung) berdasarkan tanggal pembayaran.
          </p>
          <p>
            Sisa tagihan dan tunggakan adalah saldo <span className="text-slate-200">saat ini</span>,
            bukan angka periode — keduanya sengaja dipisah.
          </p>
        </div>
      );
    }

    if (type === 'by-method') {
      return (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/30">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Metode</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Transaksi valid</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Total pemasukan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {result.by_method.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    Tidak ada pembayaran sah pada periode ini.
                  </td>
                </tr>
              ) : (
                result.by_method.map((row) => (
                  <tr key={row.method}>
                    <td className="px-4 py-3 text-slate-300">{METHOD_LABEL[row.method]}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{row.transactions}</td>
                    <td className="px-4 py-3 text-right text-white">{formatRupiah(row.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (type === 'unpaid') {
      const rows = result.rows as InvoiceRow[];
      return (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/30">
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Invoice</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Pelanggan</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Nominal</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Terbayar</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Sisa</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Jatuh tempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      Tidak ada tagihan bersisa.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-700/20 transition">
                      <td className="px-4 py-3 text-cyan-400 whitespace-nowrap">{row.invoice_number}</td>
                      <td className="px-4 py-3 text-slate-300">{row.customer_name}</td>
                      <td className="px-4 py-3 text-right text-slate-400">{formatRupiah(row.amount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-300">
                        {formatRupiah(row.paid_total)}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-medium">
                        {formatRupiah(row.remaining)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={row.overdue ? 'text-red-400' : 'text-slate-400'}>
                          {formatDate(row.due_date)}
                          {row.overdue ? ' · terlambat' : ''}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={result.total} limit={limit} onPage={setPage} />
        </div>
      );
    }

    const rows = result.rows as PaymentRow[];
    return (
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
                <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    Tidak ada transaksi pada periode ini.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-700/20 transition">
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(row.paid_at)}</td>
                    <td className="px-4 py-3 text-cyan-400 whitespace-nowrap">{row.invoice_number}</td>
                    <td className="px-4 py-3 text-slate-300">{row.customer_name}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {METHOD_LABEL[row.method]}
                    </td>
                    <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                      {formatRupiah(row.amount)}
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={result.total} limit={limit} onPage={setPage} />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Laporan</h1>
          <p className="text-slate-400 text-sm mt-1">
            Pemasukan periode, tagihan bersisa, dan rekap per metode
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!result}
          className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-40 transition"
        >
          Ekspor CSV
        </button>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="r-type">
            Jenis laporan
          </label>
          <select
            id="r-type"
            value={type}
            onChange={(e) => changeType(e.target.value as ReportType)}
            className={inputClass}
          >
            {(Object.keys(TYPE_LABEL) as ReportType[]).map((key) => (
              <option key={key} value={key}>
                {TYPE_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="r-from">
            Dari tanggal
          </label>
          <input
            id="r-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="r-to">
            Sampai tanggal
          </label>
          <input
            id="r-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="r-method">
            Metode pembayaran
          </label>
          <select
            id="r-method"
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
      </div>

      {loadError ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center space-y-3">
          <p className="text-sm text-amber-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: `Pemasukan valid ${formatDate(from)}–${formatDate(to)}`,
                value: result ? formatRupiah(result.summary.income) : '…',
              },
              { label: 'Transaksi valid', value: result ? String(result.summary.transactions) : '…' },
              {
                label: 'Sisa tagihan (saat ini)',
                value: result ? formatRupiah(result.summary.outstanding) : '…',
              },
              {
                label: 'Tunggakan jatuh tempo',
                value: result ? formatRupiah(result.summary.overdue) : '…',
              },
            ].map((card) => (
              <div key={card.label} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
                <p className="text-xs text-slate-400">{card.label}</p>
                <p className="mt-1 text-lg font-bold text-white">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/50">
              <p className="text-sm font-medium text-slate-200">Kontribusi per pengguna</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Dihitung dari akun yang <span className="text-slate-300">membuat</span> data pada
                periode ini — bukan dari pemiliknya. Admin yang membuatkan data untuk reseller tetap
                tercatat sebagai pembuat.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/30">
                    <th className="px-4 py-2 text-left font-medium text-slate-400">Pengguna</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-400">Role</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-400">Pelanggan</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-400">Voucher</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-400">Profil HS</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-400">Profil PPP</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-400">Group</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-400">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {contribLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                        Memuat kontribusi…
                      </td>
                    </tr>
                  ) : contrib.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                        Belum ada data yang dibuat pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    contrib.map((row) => (
                      <tr key={row.user_id}>
                        <td className="px-4 py-2 text-slate-200">{row.name}</td>
                        <td className="px-4 py-2 text-xs text-slate-400">{row.role}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{row.customers}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{row.vouchers}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{row.hotspot_profiles}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{row.ppp_profiles}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{row.group_profiles}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-cyan-300">{row.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-slate-800/50 border border-slate-700/50 animate-pulse"
                />
              ))}
            </div>
          ) : (
            renderTable()
          )}
        </>
      )}
    </div>
  );
};

const Pagination: React.FC<{
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}> = ({ page, totalPages, total, limit, onPage }) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-slate-700/30 text-sm text-slate-400">
    <span>
      Menampilkan {(page - 1) * limit + 1}–{Math.min(page * limit, total)} dari {total} baris
    </span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPage(Math.max(1, page - 1))}
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
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
      >
        Berikutnya
      </button>
    </div>
  </div>
);

export default Reports;

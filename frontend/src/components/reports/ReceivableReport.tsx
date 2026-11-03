import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Laporan Piutang (aging) — memakai endpoint yang sudah ada:
 *   GET /api/reports/receivables
 *   GET /api/reports/receivables/summary
 *
 * Tidak ada perhitungan saldo di browser: semua angka datang dari backend,
 * sumber yang sama dengan dashboard, sehingga tidak mungkin berbeda.
 */

type ReportType =
  | 'summary'
  | 'transactions'
  | 'unpaid'
  | 'by-method'
  | 'vouchers'
  | 'voucher-usage'
  | 'receivables';

interface Row {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  internet_no: string | null;
  username: string | null;
  owner_name: string | null;
  profile_type: string | null;
  profile_name: string | null;
  created_at: string;
  due_date: string;
  amount: number;
  paid: number;
  balance: number;
  days_late: number;
  status: string;
  bucket: 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'over_90';
}

interface Summary {
  outstanding: number;
  overdue: number;
  not_due: number;
  open_invoices: number;
  customers_with_debt: number;
  buckets: Record<Row['bucket'], { count: number; total: number }>;
}

const TYPE_LABEL: Record<ReportType, string> = {
  summary: 'Ringkasan keuangan',
  transactions: 'Detail transaksi',
  unpaid: 'Tagihan belum lunas / jatuh tempo',
  'by-method': 'Pemasukan per metode',
  vouchers: 'Penjualan voucher',
  'voucher-usage': 'Laporan Penggunaan Pertama Voucher',
  receivables: 'Laporan Piutang',
};

const BUCKET_LABEL: Record<Row['bucket'], string> = {
  not_due: 'Belum jatuh tempo',
  d1_30: '1–30 hari',
  d31_60: '31–60 hari',
  d61_90: '61–90 hari',
  over_90: 'Lebih dari 90 hari',
};

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );

const tanggal = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const readError = (error: unknown, fallback: string): string => {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
};

const inputClass =
  'w-full rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const tone =
    status === 'partial'
      ? 'bg-amber-500/15 text-amber-300'
      : status === 'unpaid'
        ? 'bg-slate-500/15 text-slate-300'
        : 'bg-slate-500/15 text-slate-400';
  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${tone}`}>{status}</span>;
};

export const ReceivableReport: React.FC<{ onChangeType: (type: ReportType) => void }> = ({
  onChangeType,
}) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [search, setSearch] = useState('');
  const [profileType, setProfileType] = useState<'' | 'hotspot' | 'ppp'>('');
  const [status, setStatus] = useState<'' | 'unpaid' | 'partial'>('');
  const [overdueOnly, setOverdueOnly] = useState<'' | 'due' | 'not_due'>('');
  const [ownerId, setOwnerId] = useState('');
  const [owners, setOwners] = useState<Array<{ id: number; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Filter "sudah/belum jatuh tempo" diterjemahkan ke rentang due_date agar
      // tetap dihitung backend (bukan filter di browser).
      const today = new Date().toISOString().slice(0, 10);
      const effectiveDueFrom = overdueOnly === 'due' ? undefined : dueFrom || undefined;
      const effectiveDueTo =
        overdueOnly === 'due' ? (dueTo || today) : overdueOnly === 'not_due' ? undefined : dueTo || undefined;

      const [list, sum] = await Promise.all([
        api.get('/api/reports/receivables', {
          params: {
            from: from || undefined,
            to: to || undefined,
            due_from: overdueOnly === 'not_due' ? today : effectiveDueFrom,
            due_to: effectiveDueTo,
            search: search.trim() || undefined,
            profile_type: profileType || undefined,
            status: status || undefined,
            owner_id: ownerId || undefined,
            page,
            limit,
          },
        }),
        api.get<Summary>('/api/reports/receivables/summary'),
      ]);
      setRows(list.data?.rows ?? []);
      setTotal(list.data?.total ?? 0);
      setSummary(sum.data);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(readError(e, 'Gagal memuat laporan piutang.'));
    } finally {
      setLoading(false);
    }
  }, [from, to, dueFrom, dueTo, search, profileType, status, overdueOnly, ownerId, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    api
      .get('/api/admin/users', { params: { limit: 100 } })
      .then((res) => {
        if (!alive) return;
        const list = Array.isArray(res.data) ? res.data : (res.data?.rows ?? []);
        setOwners(
          (list as Array<{ id: number; name: string }>)
            .map((user) => ({ id: Number(user.id), name: String(user.name) }))
            .filter((user) => Number.isFinite(user.id)),
        );
      })
      .catch(() => {
        // Tanpa izin (operator/reseller) filter owner memang tidak ditampilkan.
        if (alive) setOwners([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const halamanTerakhir = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Laporan Piutang</h2>
          <p className="text-xs text-slate-400">
            Saldo = sisa tagihan unpaid/partial. Aging dihitung dari tanggal jatuh tempo.
          </p>
        </div>
        <select
          value="receivables"
          onChange={(event) => onChangeType(event.target.value as ReportType)}
          className="rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-slate-100"
        >
          {(Object.keys(TYPE_LABEL) as ReportType[]).map((key) => (
            <option key={key} value={key}>
              {TYPE_LABEL[key]}
            </option>
          ))}
        </select>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Total piutang', rupiah(summary.outstanding), 'text-amber-300'],
              ['Sudah jatuh tempo', rupiah(summary.overdue), 'text-red-300'],
              ['Belum jatuh tempo', rupiah(summary.not_due), 'text-slate-100'],
              ['Tagihan terbuka', `${summary.open_invoices} · ${summary.customers_with_debt} pelanggan`, 'text-cyan-300'],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-lg border border-slate-700/60 bg-slate-800/60 p-3">
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`mt-1 text-sm font-semibold ${tone}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {(Object.keys(BUCKET_LABEL) as Row['bucket'][]).map((key) => (
              <div key={key} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-2">
                <p className="text-[11px] text-slate-400">{BUCKET_LABEL[key]}</p>
                <p className="text-sm font-medium text-slate-100">{rupiah(summary.buckets[key]?.total ?? 0)}</p>
                <p className="text-[11px] text-slate-500">{summary.buckets[key]?.count ?? 0} tagihan</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
        <div className="grid gap-2 md:grid-cols-4">
          <label className="text-xs text-slate-400">
            Tanggal transaksi dari
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={inputClass} />
          </label>
          <label className="text-xs text-slate-400">
            sampai
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={inputClass} />
          </label>
          {owners.length > 0 && (
            <label className="text-xs text-slate-400">
              Owner / reseller
              <select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPage(1); }} className={inputClass}>
                <option value="">Semua</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-400">
            Jatuh tempo dari
            <input type="date" value={dueFrom} onChange={(e) => { setDueFrom(e.target.value); setPage(1); }} className={inputClass} />
          </label>
          <label className="text-xs text-slate-400">
            sampai
            <input type="date" value={dueTo} onChange={(e) => { setDueTo(e.target.value); setPage(1); }} className={inputClass} />
          </label>

          <label className="text-xs text-slate-400 md:col-span-2">
            Cari (pelanggan / No. Internet / invoice)
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="mis. 1312016 atau INV-2026-0004"
              className={inputClass}
            />
          </label>
          <label className="text-xs text-slate-400">
            Jenis layanan
            <select value={profileType} onChange={(e) => { setProfileType(e.target.value as '' | 'hotspot' | 'ppp'); setPage(1); }} className={inputClass}>
              <option value="">Semua</option>
              <option value="hotspot">Hotspot</option>
              <option value="ppp">PPPoE</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Status
            <select value={status} onChange={(e) => { setStatus(e.target.value as '' | 'unpaid' | 'partial'); setPage(1); }} className={inputClass}>
              <option value="">Semua</option>
              <option value="unpaid">unpaid</option>
              <option value="partial">partial</option>
            </select>
          </label>
          {owners.length > 0 && (
            <label className="text-xs text-slate-400">
              Owner / reseller
              <select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPage(1); }} className={inputClass}>
                <option value="">Semua</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-400">
            Jatuh tempo
            <select value={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.value as '' | 'due' | 'not_due'); setPage(1); }} className={inputClass}>
              <option value="">Semua</option>
              <option value="due">Sudah jatuh tempo</option>
              <option value="not_due">Belum jatuh tempo</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Baris
            <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className={inputClass}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-800/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-700/30 text-left text-xs uppercase text-slate-400">
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Pelanggan</th>
              <th className="px-3 py-2">No. Internet</th>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Layanan</th>
              <th className="px-3 py-2">Paket</th>
              <th className="px-3 py-2">Transaksi</th>
              <th className="px-3 py-2">Jatuh tempo</th>
              <th className="px-3 py-2 text-right">Tagihan</th>
              <th className="px-3 py-2 text-right">Dibayar</th>
              <th className="px-3 py-2 text-right">Sisa</th>
              <th className="px-3 py-2 text-right">Umur</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-sm text-slate-400">Memuat…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && !error && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-sm text-slate-400">
                  Tidak ada piutang pada filter ini.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-700/20">
                <td className="px-3 py-2 font-mono text-[11px] text-cyan-300">
                  <a href={`/invoices?search=${encodeURIComponent(row.invoice_number)}`}>{row.invoice_number}</a>
                </td>
                <td className="px-3 py-2 text-slate-100">
                  <a href={`/customers?search=${encodeURIComponent(row.internet_no ?? row.customer_name)}`}>
                    {row.customer_name}
                  </a>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{row.internet_no ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">{row.username ?? '—'}</td>
                <td className="px-3 py-2 text-slate-400">{row.owner_name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">{row.profile_type === 'ppp' ? 'PPPoE' : row.profile_type === 'hotspot' ? 'Hotspot' : '—'}</td>
                <td className="px-3 py-2 text-slate-300">{row.profile_name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-400">{tanggal(row.created_at)}</td>
                <td className="px-3 py-2 text-slate-300">{tanggal(row.due_date)}</td>
                <td className="px-3 py-2 text-right text-slate-200">{rupiah(row.amount)}</td>
                <td className="px-3 py-2 text-right text-emerald-300">{rupiah(row.paid)}</td>
                <td className="px-3 py-2 text-right font-medium text-amber-300">{rupiah(row.balance)}</td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {row.days_late > 0 ? `${row.days_late} hari` : '—'}
                </td>
                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          {total} baris · halaman {page} dari {halamanTerakhir}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-slate-100 disabled:opacity-40"
          >
            Sebelumnya
          </button>
          <button
            type="button"
            disabled={page >= halamanTerakhir || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-slate-100 disabled:opacity-40"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </div>
  );
};
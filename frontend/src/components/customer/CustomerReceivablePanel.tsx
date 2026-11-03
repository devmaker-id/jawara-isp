import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Ringkasan piutang + riwayat perpanjangan milik satu pelanggan.
 *
 * Saldo dihitung backend dari sisa tagihan (bukan tabel piutang terpisah).
 * Batas kredit hanya bisa diubah admin; tombolnya disembunyikan untuk peran
 * lain, dan backend tetap menolak (403) bila dipaksa.
 */

interface ReceivableInvoice {
  id: number;
  invoice_number: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  due_date: string;
  days_late: number;
}

interface ReceivablePayload {
  outstanding: number;
  limit: number;
  remaining: number;
  open_invoices: number;
  overdue: number;
  not_due: number;
  invoices: ReceivableInvoice[];
}

interface RenewalRow {
  id: number;
  username: string;
  profile_name: string;
  period_start: string;
  period_end: string | null;
  amount: number;
  invoice_id: number | null;
  payment_id: number | null;
  actor_name: string | null;
  created_at: string;
}

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

const tanggal = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const readError = (error: unknown, fallback: string): string => {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
};

export const CustomerReceivablePanel: React.FC<{ customerId: number; canSetLimit: boolean }> = ({
  customerId,
  canSetLimit,
}) => {
  const [data, setData] = useState<ReceivablePayload | null>(null);
  const [history, setHistory] = useState<RenewalRow[]>([]);
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ar, rn] = await Promise.all([
        api.get<ReceivablePayload>(`/api/customers/${customerId}/receivable`),
        api.get<RenewalRow[]>(`/api/customers/${customerId}/renewals`),
      ]);
      setData(ar.data);
      setLimit(String(ar.data.limit));
      setHistory(Array.isArray(rn.data) ? rn.data.slice(0, 5) : []);
      setError(null);
    } catch (e) {
      setError(readError(e, 'Gagal memuat data piutang.'));
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const simpanLimit = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { data: saved } = await api.patch(`/api/customers/${customerId}/credit-limit`, {
        limit: Number(limit || 0),
      });
      setNote(`Batas piutang disimpan: ${rupiah(saved.limit)}.`);
      await load();
    } catch (e) {
      setNote(readError(e, 'Gagal menyimpan batas piutang.'));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-xs text-red-300">{error}</p>;
  if (!data) return <p className="text-xs text-slate-500">Memuat piutang…</p>;

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Piutang pelanggan</p>
        <span className="text-xs text-slate-400">{data.open_invoices} tagihan belum lunas</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300 sm:grid-cols-4">
        <div>
          <p className="text-slate-500">Saldo piutang</p>
          <p className="font-medium text-amber-300">{rupiah(data.outstanding)}</p>
        </div>
        <div>
          <p className="text-slate-500">Jatuh tempo</p>
          <p className="font-medium text-red-300">{rupiah(data.overdue)}</p>
        </div>
        <div>
          <p className="text-slate-500">Belum jatuh tempo</p>
          <p className="font-medium text-slate-100">{rupiah(data.not_due)}</p>
        </div>
        <div>
          <p className="text-slate-500">Batas / sisa</p>
          <p className="font-medium text-cyan-300">
            {rupiah(data.limit)} / {rupiah(data.remaining)}
          </p>
        </div>
      </div>

      {data.invoices.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="tbl-compact">
            <thead>
              <tr>
                <th className="py-1 pr-2">Tagihan</th>
                <th className="py-1 pr-2">Jatuh tempo</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 text-right">Sisa</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-1 pr-2 font-mono text-[11px] text-slate-300">{invoice.invoice_number}</td>
                  <td className="py-1 pr-2 text-slate-300">
                    {tanggal(invoice.due_date)}
                    {invoice.days_late > 0 ? (
                      <span className="ml-1 text-red-300">(+{invoice.days_late}h)</span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2">
                    <span className={invoice.status === 'partial' ? 'text-amber-300' : 'text-slate-300'}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="py-1 text-right text-slate-100">{rupiah(invoice.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canSetLimit && (
        <div className="mt-3 flex items-end gap-2">
          <label className="text-xs text-slate-400">
            Batas piutang
            <input
              type="number"
              min={0}
              step="1000"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="mt-1 w-32 rounded-lg border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void simpanLimit()}
            disabled={busy}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-600 disabled:opacity-60"
          >
            {busy ? 'Menyimpan…' : 'Simpan limit'}
          </button>
          {note && <span className="text-xs text-cyan-300">{note}</span>}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-400">Riwayat perpanjangan</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-300">
            {history.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-2 border-b border-slate-700/30 py-1">
                <span className="text-slate-500">{tanggal(row.created_at)}</span>
                <span className="font-mono text-[11px]">{row.username}</span>
                <span>{row.profile_name}</span>
                <span>
                  {tanggal(row.period_start)} → {tanggal(row.period_end)}
                </span>
                <span className={row.payment_id ? 'text-emerald-300' : 'text-amber-300'}>
                  {rupiah(row.amount)} · {row.payment_id ? 'tunai' : 'piutang'}
                </span>
                <span className="text-slate-500">{row.actor_name ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
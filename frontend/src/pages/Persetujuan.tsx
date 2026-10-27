import React, { useCallback, useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';

/**
 * Antrean persetujuan hapus.
 *
 * Reseller boleh mengubah data tetapi tidak boleh menghapus; permintaan
 * hapusnya menunggu di sini. Operator dan admin memutuskan. Menyetujui hanya
 * menandai permintaan — penghapusan sebenarnya dijalankan endpoint modul asal
 * (mis. DELETE /customers/:id) dengan hak akun pemutus.
 */

interface ApprovalRow {
  id: number;
  requested_by: number;
  requester_name: string | null;
  action: string;
  target_type: string;
  target_id: number;
  summary: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: number | null;
  decider_name: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
}

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const STATUS_LABEL: Record<ApprovalRow['status'], string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
};

// Endpoint hapus per jenis data. Menyetujui = menjalankan yang ini.
const DELETE_PATH: Record<string, (id: number) => string> = {
  customer: (id) => `/api/customers/${id}`,
  invoice: (id) => `/api/invoices/${id}`,
  group: (id) => `/api/profiles/groups/${id}`,
};

const Persetujuan: React.FC = () => {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    try {
      const res = await api.get<ApprovalRow[]>('/api/admin/approvals', { params: { status } });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      setRows([]);
      setNotice({ kind: 'error', text: readError(error, 'Gagal memuat antrean persetujuan.') });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  const decide = async (row: ApprovalRow, approve: boolean) => {
    setBusy(row.id);
    setNotice(null);
    try {
      await api.post(`/api/admin/approvals/${row.id}/${approve ? 'approve' : 'reject'}`, {
        note: approve ? 'disetujui dari halaman persetujuan' : 'ditolak dari halaman persetujuan',
      });

      // Menyetujui baru menandai. Penghapusan dijalankan di sini, dengan hak
      // akun pemutus, supaya endpoint asal tetap satu-satunya jalur hapus.
      if (approve) {
        const path = DELETE_PATH[row.target_type];
        if (path) {
          try {
            await api.delete(path(row.target_id));
            setNotice({ kind: 'ok', text: `Disetujui dan dihapus: ${row.summary}` });
          } catch (error) {
            setNotice({
              kind: 'error',
              text:
                `Permintaan disetujui, tetapi penghapusan gagal: ` +
                readError(error, 'lihat pesan dari server.'),
            });
          }
        } else {
          setNotice({
            kind: 'ok',
            text: `Disetujui: ${row.summary}. Hapus manual dari menu terkait.`,
          });
        }
      } else {
        setNotice({ kind: 'ok', text: `Ditolak: ${row.summary}` });
      }
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: readError(error, 'Gagal memproses permintaan.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Persetujuan Hapus</h1>
          <p className="text-slate-400 text-sm mt-1">
            Reseller tidak menghapus langsung — permintaannya menunggu keputusan operator/admin.
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'pending' | 'all')}
          className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-100 text-sm"
        >
          <option value="pending">Hanya menunggu</option>
          <option value="all">Semua riwayat</option>
        </select>
      </div>

      {notice && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            notice.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border border-red-500/30'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/30">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Diminta oleh</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Data</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Waktu</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Memuat…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Tidak ada permintaan.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-700/20 transition">
                    <td className="px-4 py-3 text-slate-200">
                      {row.requester_name ?? `#${row.requested_by}`}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.summary}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(row.created_at).toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          row.status === 'pending'
                            ? 'bg-amber-500/10 text-amber-300'
                            : row.status === 'approved'
                              ? 'bg-emerald-500/10 text-emerald-300'
                              : 'bg-slate-600/30 text-slate-300'
                        }`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {row.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy === row.id}
                              onClick={() => void decide(row, true)}
                              className="px-2.5 py-1.5 rounded-lg text-xs text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 transition"
                            >
                              Setujui &amp; hapus
                            </button>
                            <button
                              type="button"
                              disabled={busy === row.id}
                              onClick={() => void decide(row, false)}
                              className="px-2.5 py-1.5 rounded-lg text-xs text-red-300 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 transition"
                            >
                              Tolak
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">
                            {row.decider_name ? `oleh ${row.decider_name}` : '—'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Persetujuan;

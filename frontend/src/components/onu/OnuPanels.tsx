import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Panel ONU bersama: drawer detail + riwayat pemasangan.
 *
 * Dipakai halaman Inventori ONU dan detail pelanggan, supaya tidak ada dua
 * komponen riwayat yang berbeda perilaku. Datanya dari endpoint yang sudah ada
 * (GET /api/olt/onus/:id/history); tidak ada endpoint baru.
 */

export interface OnuRow {
  id: number;
  olt_id: number;
  olt_name: string;
  customer_id: number | null;
  customer_name?: string | null;
  internet_no?: string | null;
  port_id: string;
  onu_id: string;
  serial_number: string | null;
  onu_mac: string | null;
  onu_name?: string | null;
  description: string | null;
  admin_state: string | null;
  omcc_state: string | null;
  phase_state: string | null;
  online: boolean;
  rx_power_onu: number | null;
  rx_power_olt: number | null;
  tx_power: number | null;
  temperature: number | null;
  voltage: number | null;
  tx_bias: number | null;
  last_seen_at: string;
  optical_read_at?: string | null;
  missing_at?: string | null;
}

interface HistoryRow {
  id: number;
  action: 'assign' | 'release' | 'move';
  onu_label: string;
  from_customer_id: number | null;
  to_customer_id: number | null;
  from_customer_name: string | null;
  to_customer_name: string | null;
  from_internet_no: string | null;
  to_internet_no: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

const AKSI: Record<HistoryRow['action'], { label: string; tone: string }> = {
  assign: { label: 'Pemasangan', tone: 'text-emerald-300' },
  release: { label: 'Pelepasan', tone: 'text-amber-300' },
  move: { label: 'Pemindahan', tone: 'text-cyan-300' },
};

const waktu = (value?: string | null) =>
  value ? new Date(value).toLocaleString('id-ID') : '—';

const angka = (value: number | null | undefined, satuan: string) =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(2)} ${satuan}`;

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
};

const HistoryTable: React.FC<{ onuId: number }> = ({ onuId }) => {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/olt/onus/${onuId}/history`);
      setRows(res.data?.rows ?? []);
      setError(null);
    } catch (e) {
      setError(readError(e, 'Gagal memuat riwayat ONU.'));
    }
  }, [onuId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (rows === null) return <p className="text-sm text-slate-400">Memuat riwayat…</p>;
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Belum ada riwayat pemasangan untuk ONU ini.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50 text-left text-xs uppercase text-slate-400">
            <th className="py-2 pr-3">Waktu</th>
            <th className="py-2 pr-3">Tindakan</th>
            <th className="py-2 pr-3">Dari</th>
            <th className="py-2 pr-3">Ke</th>
            <th className="py-2 pr-3">Operator</th>
            <th className="py-2">Catatan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const aksi = AKSI[row.action] ?? { label: row.action, tone: 'text-slate-300' };
            const sisi = (nama: string | null, nomor: string | null) =>
              nama ? (
                <span>
                  {nama}
                  {nomor ? <span className="ml-1 font-mono text-[11px] text-cyan-300">{nomor}</span> : null}
                </span>
              ) : (
                <span className="text-slate-500">—</span>
              );
            return (
              <tr key={row.id} className="border-b border-slate-700/30 align-top">
                <td className="py-2 pr-3 text-xs text-slate-400">{waktu(row.created_at)}</td>
                <td className={`py-2 pr-3 text-xs font-medium ${aksi.tone}`}>{aksi.label}</td>
                <td className="py-2 pr-3 text-xs text-slate-300">{sisi(row.from_customer_name, row.from_internet_no)}</td>
                <td className="py-2 pr-3 text-xs text-slate-300">{sisi(row.to_customer_name, row.to_internet_no)}</td>
                <td className="py-2 pr-3 text-xs text-slate-400">{row.actor_name ?? '—'}</td>
                <td className="py-2 text-xs text-slate-400">{row.note ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** Modal riwayat — dipakai halaman pelanggan (data ONU di sana ringkas). */
export const OnuHistoryModal: React.FC<{
  onuId: number;
  title: string;
  subtitle?: string;
  onClose: () => void;
}> = ({ onuId, title, subtitle, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Riwayat ONU</h2>
          <p className="mt-1 font-mono text-xs text-slate-400">
            {title}
            {subtitle ? ` · ${subtitle}` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-white" aria-label="Tutup">
          Tutup
        </button>
      </div>
      <div className="mt-4">
        <HistoryTable onuId={onuId} />
      </div>
    </div>
  </div>
);

/** Drawer detail ONU — dipakai halaman inventori. */
export const OnuDetailDrawer: React.FC<{ onu: OnuRow; onClose: () => void }> = ({ onu, onClose }) => {
  const baris: Array<[string, React.ReactNode]> = [
    ['Serial / MAC', onu.serial_number || onu.onu_mac || '—'],
    ['Nama ONU', onu.onu_name || '—'],
    ['Deskripsi', onu.description || '—'],
    ['Perangkat', `${onu.olt_name} · PON ${onu.port_id} · ONU ${onu.onu_id}`],
    ['Status', onu.missing_at ? `hilang sejak ${waktu(onu.missing_at)}` : onu.online ? 'online' : 'offline'],
    ['Pelanggan', onu.customer_id ? `${onu.customer_name ?? '—'} (${onu.internet_no ?? '—'})` : 'belum terpasang'],
    ['Rx ONU', angka(onu.rx_power_onu, 'dBm')],
    ['Rx OLT', angka(onu.rx_power_olt, 'dBm')],
    ['Tx power', angka(onu.tx_power, 'dBm')],
    ['Suhu', angka(onu.temperature, '°C')],
    ['Tegangan', angka(onu.voltage, 'V')],
    ['TX bias', angka(onu.tx_bias, 'mA')],
    ['Terakhir terlihat', waktu(onu.last_seen_at)],
    ['Redaman dibaca', onu.optical_read_at ? waktu(onu.optical_read_at) : 'belum pernah dibaca'],
    ['Status admin / OMCC', `${onu.admin_state ?? '—'} / ${onu.omcc_state ?? '—'}`],
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-700 bg-slate-800 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Detail ONU</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">
              {onu.serial_number || onu.onu_mac || `#${onu.id}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-white" aria-label="Tutup">
            Tutup
          </button>
        </div>

        <dl className="mt-4 space-y-1 text-sm">
          {baris.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-slate-700/40 py-1">
              <dt className="text-slate-400">{label}</dt>
              <dd className="text-right text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-5 text-sm font-semibold text-white">Riwayat pemasangan</h3>
        <div className="mt-2">
          <HistoryTable onuId={onu.id} />
        </div>
      </div>
    </div>
  );
};
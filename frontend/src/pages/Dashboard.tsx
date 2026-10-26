import React, { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  errorMessage,
  formatBytes,
  formatUptime,
} from '../components/net/NetUI';

interface ServerMetrics {
  uptime_seconds: number;
  cpu_count: number;
  cpu_percent: number | null;
  processes: number;
  mem_total: number;
  mem_used: number;
  disk_total: number;
  disk_used: number;
}

interface OnlineCounts {
  hotspot: number | null;
  ppp: number | null;
  device: string | null;
  error: string | null;
}

interface DashboardData {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
  server: ServerMetrics;
  online: OnlineCounts;
}

const rupiah = (value: number) => `Rp ${value.toLocaleString('id-ID')}`;

const percent = (used: number, total: number) =>
  total > 0 ? Math.round((used / total) * 100) : 0;

// Tile kecil untuk status server: satu angka besar, satu keterangan.
const Metric: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
    <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-0.5 text-sm font-semibold text-slate-100">{value}</div>
    {note && <div className="text-[11px] text-slate-500">{note}</div>}
  </div>
);

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<DashboardData>('/api/dashboard');
      setData(response.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const server = data?.server;
  const online = data?.online;

  return (
    <div className="page-container">
      <PageHeader
        title="Dashboard"
        subtitle="Kondisi server, sesi aktif, dan tagihan."
        actions={<Button onClick={() => void load()}>Muat ulang</Button>}
      />

      {loading && <Loading label="Memuat dashboard…" />}
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      {data && server && online && !loading && (
        <>
          <Card className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status server</p>
              <Badge tone={(server.cpu_percent ?? 0) > 85 ? 'warn' : 'good'}>
                {server.cpu_count} core
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Metric label="Uptime" value={formatUptime(server.uptime_seconds)} />
              <Metric
                label="RAM"
                value={`${percent(server.mem_used, server.mem_total)}%`}
                note={`${formatBytes(server.mem_used)} / ${formatBytes(server.mem_total)}`}
              />
              <Metric
                label="Disk"
                value={`${percent(server.disk_used, server.disk_total)}%`}
                note={`${formatBytes(server.disk_used)} / ${formatBytes(server.disk_total)}`}
              />
              <Metric
                label="CPU"
                value={server.cpu_percent === null ? '—' : `${server.cpu_percent}%`}
                note={`${server.cpu_count} core`}
              />
              <Metric label="Proses" value={server.processes.toLocaleString('id-ID')} />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card>
              <p className="text-xs text-slate-400">Pelanggan</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">
                {data.total_customers.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500">{data.total_invoices} tagihan</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Tagihan belum bayar</p>
              <p className="mt-1 text-xl font-semibold text-amber-300">{rupiah(data.unpaid_total)}</p>
              <p className="text-[11px] text-slate-500">{data.unpaid_count} tagihan</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Pendapatan hari ini</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">
                {rupiah(data.today_revenue)}
              </p>
              <p className="text-[11px] text-slate-500">{data.today_payments} pembayaran</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Online hotspot</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">
                {online.hotspot === null ? '—' : online.hotspot.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500">{online.device ?? 'perangkat default'}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Online PPP</p>
              <p className="mt-1 text-xl font-semibold text-slate-100">
                {online.ppp === null ? '—' : online.ppp.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500">{online.device ?? 'perangkat default'}</p>
            </Card>
          </div>

          {online.error && (
            <p className="mt-3 text-xs text-amber-300">
              Sesi online tidak terbaca: {online.error}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;

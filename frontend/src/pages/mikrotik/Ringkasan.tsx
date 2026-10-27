import React from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  StatCard,
  formatNumber,
  formatUptime,
  useDeviceSelection,
  DeviceBar,
  useNet,
} from '../../components/net/NetUI';

interface StatusPayload {
  configured: boolean;
  connected: boolean;
  host: string;
  port: number;
  gui_url: string;
  write_enabled: boolean;
  checked_at?: string;
  identity?: string | null;
  version?: string | null;
  board?: string | null;
  uptime?: string | null;
  cpu_load?: number;
  memory_total_mb?: number;
  memory_free_mb?: number;
  interfaces?: { total: number; running: number; disabled: number };
  message?: string;
}

interface ResourcePayload {
  uptime_seconds: number;
  cpu_load: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_free_mb: number;
  hdd_total_mb: number;
  hdd_free_mb: number;
  version: string | null;
  board: string | null;
  architecture: string | null;
  cpu: string | null;
  cpu_count: number;
  load_average: string | null;
}

const Ringkasan: React.FC = () => {
  const deviceSel = useDeviceSelection();
  const status = useNet<StatusPayload>('/api/mikrotik/status' + deviceSel.query);
  const resources = useNet<ResourcePayload>('/api/mikrotik/resources' + deviceSel.query, Boolean(status.data?.connected));

  const data = status.data;
  const memUsedPercent =
    resources.data && resources.data.memory_total_mb > 0
      ? Math.round((resources.data.memory_used_mb / resources.data.memory_total_mb) * 100)
      : null;

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — Ringkasan"
        subtitle="Status perangkat lewat RouterOS API (TCP). Halaman ini hanya membaca; tidak ada perubahan konfigurasi."
        actions={
          data?.gui_url ? (
            <a
              href={data.gui_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-cyan-500 bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Buka WebFig
            </a>
          ) : undefined
        }
      />

      {status.loading && <Loading label="Menghubungi perangkat…" />}
      {status.error && <ErrorNote message={status.error} onRetry={status.reload} />}

      {data && !status.loading && (
        <>
          {!data.configured && (
            <InfoNote tone="warn">
              {data.message ?? 'Integrasi MikroTik belum dikonfigurasi.'}
              {'\n'}Lengkapi host, port, user, dan password API di halaman Pengaturan.
            </InfoNote>
          )}

          {data.configured && !data.connected && (
            <ErrorNote
              message={`Perangkat tidak dapat dibaca.\n${data.message ?? ''}`}
              onRetry={status.reload}
            />
          )}

          {data.connected && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
                <StatCard label="Identitas" value={data.identity ?? '-'} hint={`${data.host}:${data.port}`} />
                <StatCard label="RouterOS" value={data.version ?? '-'} hint={data.board ?? '-'} />
                <StatCard label="Uptime" value={data.uptime ?? '-'} hint="Waktu aktif perangkat" />
                <StatCard
                  label="Beban CPU"
                  value={`${formatNumber(data.cpu_load)}%`}
                  tone={(data.cpu_load ?? 0) > 80 ? 'bad' : (data.cpu_load ?? 0) > 50 ? 'warn' : 'good'}
                  hint={data.checked_at ? `Diperiksa ${new Date(data.checked_at).toLocaleTimeString('id-ID')}` : undefined}
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-3 mb-4">
                <Card>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Interface</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {formatNumber(data.interfaces?.total)} total
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatNumber(data.interfaces?.running)} aktif · {formatNumber(data.interfaces?.disabled)} nonaktif
                  </p>
                  <Link to="/mikrotik/interface" className="mt-3 inline-block text-xs text-cyan-400 hover:underline">
                    Lihat interface →
                  </Link>
                </Card>

                <Card>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Memori</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {resources.data ? `${formatNumber(resources.data.memory_used_mb)} MB terpakai` : '-'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {memUsedPercent !== null
                      ? `${memUsedPercent}% dari ${formatNumber(resources.data?.memory_total_mb)} MB`
                      : 'Data resource belum terbaca'}
                  </p>
                </Card>

                <Card>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Mode tulis</p>
                  <p className="mt-2">
                    {data.write_enabled ? (
                      <Badge tone="warn">Aktif — perubahan dikirim ke perangkat</Badge>
                    ) : (
                      <Badge tone="good">Nonaktif — panel hanya membaca</Badge>
                    )}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    Saklar <code className="text-slate-300">mikrotik_write_enabled</code> diatur di Pengaturan → Integrasi.
                  </p>
                </Card>
              </div>

              {resources.data && (
                <Card>
                  <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Resource perangkat</p>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500 text-xs">CPU</dt>
                      <dd className="text-slate-200">{resources.data.cpu ?? '-'} ({resources.data.cpu_count} core)</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Arsitektur</dt>
                      <dd className="text-slate-200">{resources.data.architecture ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Uptime</dt>
                      <dd className="text-slate-200">{formatUptime(resources.data.uptime_seconds)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Load average</dt>
                      <dd className="text-slate-200">{resources.data.load_average ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Memori bebas</dt>
                      <dd className="text-slate-200">{formatNumber(resources.data.memory_free_mb)} MB</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Disk bebas</dt>
                      <dd className="text-slate-200">
                        {formatNumber(resources.data.hdd_free_mb)} / {formatNumber(resources.data.hdd_total_mb)} MB
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Beban CPU</dt>
                      <dd className="text-slate-200">{formatNumber(resources.data.cpu_load)}%</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 text-xs">Board</dt>
                      <dd className="text-slate-200">{resources.data.board ?? '-'}</dd>
                    </div>
                  </dl>
                </Card>
              )}

              <p className="mt-4 text-xs text-slate-500">
                Perubahan konfigurasi (hotspot user, PPP secret, interface) ada di sub-menu terkait dan hanya
                tersedia untuk admin ketika mode tulis diaktifkan.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default Ringkasan;
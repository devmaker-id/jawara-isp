import React from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  StatCard,
  formatNumber,
  useNet,
} from '../../components/net/NetUI';
import InstallPanel from './InstallPanel';

interface RadiusStatus {
  database: string;
  host: string;
  auth_port: number;
  secret_configured: boolean;
  tables_present: string[];
  tables_missing: string[];
  ready: boolean;
  installed: boolean;
  nas?: number;
  users?: number;
  active_sessions?: number;
  groups?: number;
  last_accounting_at?: string | null;
  message?: string;
  // Status paket FreeRADIUS di server (terpisah dari status skema database).
  server?: {
    installed: boolean;
    version: string | null;
    service_active: boolean;
    sql_module: boolean;
  };
}

const Ringkasan: React.FC = () => {
  const status = useNet<RadiusStatus>('/api/freeradius/status');
  const data = status.data;

  return (
    <div>
      <PageHeader
        title="FreeRADIUS — Ringkasan"
        subtitle="Status integrasi RADIUS: skema database, NAS terdaftar, user, dan sesi akuntansi."
        actions={<Button onClick={status.reload}>Muat ulang</Button>}
      />

      {status.loading && <Loading />}
      {status.error && <ErrorNote message={status.error} onRetry={status.reload} />}

      {/* Panel pemasangan sengaja di luar blok loading: kalau ikut unmount saat
          status dimuat ulang, log pemasangan yang sedang berjalan ikut hilang. */}
      <InstallPanel onFinished={status.reload} />

      {data && !status.loading && (
        <>
          {data.server && !data.server.installed && (
            <div className="mb-4">
              <InfoNote tone="warn">
                Server FreeRADIUS belum terpasang di mesin ini. Tabel database sudah ada,
                tetapi tidak ada proses yang melayani autentikasi. Pasang lewat tombol di atas.
              </InfoNote>
            </div>
          )}

          {!data.ready && (
            <div className="mb-4">
              <InfoNote tone="warn">
                {data.message ?? 'Skema FreeRADIUS belum siap.'}
                {'\n\n'}Tabel yang belum ada: {data.tables_missing.join(', ')}
                {'\n'}Langkah: jalankan migrasi backend/migrations/004_freeradius_schema.sql, pasang paket
                freeradius + freeradius-mysql, lalu arahkan konfigurasi SQL FreeRADIUS ke database ini.
                {'\n'}Panduan lengkap: docs/freeradius-setup.md
              </InfoNote>
            </div>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Status skema"
              value={data.ready ? 'Siap' : 'Belum siap'}
              tone={data.ready ? 'good' : 'bad'}
              hint={`${data.tables_present.length}/${data.tables_present.length + data.tables_missing.length} tabel`}
            />
            <StatCard label="NAS terdaftar" value={data.ready ? formatNumber(data.nas) : '-'} hint="perangkat yang boleh minta autentikasi" />
            <StatCard label="User RADIUS" value={data.ready ? formatNumber(data.users) : '-'} hint="entri radcheck" />
            <StatCard
              label="Sesi aktif"
              value={data.ready ? formatNumber(data.active_sessions) : '-'}
              tone={data.ready && (data.active_sessions ?? 0) > 0 ? 'good' : 'default'}
              hint="acctstoptime NULL"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Koneksi</p>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Database</dt>
                  <dd className="text-slate-200 font-mono text-xs">{data.database}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Host auth</dt>
                  <dd className="text-slate-200 font-mono text-xs">
                    {data.host}:{data.auth_port}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Secret</dt>
                  <dd>
                    {data.secret_configured ? (
                      <Badge tone="good">terisi</Badge>
                    ) : (
                      <Badge tone="bad">belum diisi</Badge>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Akuntansi terakhir</dt>
                  <dd className="text-slate-200 text-xs">
                    {data.last_accounting_at
                      ? new Date(data.last_accounting_at).toLocaleString('id-ID')
                      : 'belum ada'}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Tabel skema</p>
              <div className="flex flex-wrap gap-1.5">
                {[...data.tables_present].map((table) => (
                  <Badge key={table} tone="good">
                    {table}
                  </Badge>
                ))}
                {data.tables_missing.map((table) => (
                  <Badge key={table} tone="bad">
                    {table}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              to="/freeradius/nas"
              className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 hover:border-cyan-500/60"
            >
              <p className="text-sm font-medium text-slate-100">NAS</p>
              <p className="mt-1 text-xs text-slate-400">Daftarkan MikroTik sebagai klien RADIUS beserta secret.</p>
            </Link>
            <Link
              to="/freeradius/user"
              className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 hover:border-cyan-500/60"
            >
              <p className="text-sm font-medium text-slate-100">User RADIUS</p>
              <p className="mt-1 text-xs text-slate-400">Kelola akun radcheck (password + grup) untuk PPPoE/hotspot.</p>
            </Link>
            <Link
              to="/freeradius/sesi"
              className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 hover:border-cyan-500/60"
            >
              <p className="text-sm font-medium text-slate-100">Sesi & akuntansi</p>
              <p className="mt-1 text-xs text-slate-400">Lihat sesi berjalan dan riwayat akuntansi dari radacct.</p>
            </Link>
          </div>
        </>
      )}
    </div>
  );
};

export default Ringkasan;
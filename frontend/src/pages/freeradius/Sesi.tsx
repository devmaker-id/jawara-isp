import React, { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  StatCard,
  Table,
  Tabs,
  formatBytes,
  formatNumber,
  formatUptime,
  useNet,
} from '../../components/net/NetUI';

interface SessionRow {
  radacctid: number;
  username: string;
  nasipaddress: string | null;
  framedipaddress: string | null;
  acctstarttime: string | null;
  acctstoptime?: string | null;
  acctsessiontime: number | null;
  acctinputoctets: number | null;
  acctoutputoctets: number | null;
  callingstationid: string | null;
  acctterminatecause?: string | null;
}

const formatTime = (value: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
};

const Sesi: React.FC = () => {
  const [tab, setTab] = useState('active');
  const sessions = useNet<SessionRow[]>('/api/freeradius/sessions');
  const accounting = useNet<SessionRow[]>('/api/freeradius/accounting');

  return (
    <div>
      <PageHeader
        title="FreeRADIUS — Sesi & Akuntansi"
        subtitle="Sesi berjalan (acctstoptime NULL) dan riwayat akuntansi dari tabel radacct."
        actions={
          <Button
            onClick={() => {
              sessions.reload();
              accounting.reload();
            }}
          >
            Muat ulang
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Sesi aktif"
          value={formatNumber(sessions.data?.length)}
          tone={(sessions.data?.length ?? 0) > 0 ? 'good' : 'default'}
        />
        <StatCard label="Riwayat (maks 100)" value={formatNumber(accounting.data?.length)} hint="urut waktu mulai terbaru" />
        <StatCard
          label="Total trafik sesi aktif"
          value={
            sessions.data
              ? formatBytes(
                  sessions.data.reduce(
                    (total, row) => total + (row.acctinputoctets ?? 0) + (row.acctoutputoctets ?? 0),
                    0,
                  ),
                )
              : '-'
          }
          hint={sessions.error ? 'data belum tersedia' : undefined}
        />
      </div>

      <Tabs
        tabs={[
          { key: 'active', label: 'Sesi aktif', count: sessions.data?.length },
          { key: 'history', label: 'Riwayat', count: accounting.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'active' && (
        <>
          {sessions.loading && <Loading />}
          {sessions.error && <ErrorNote message={sessions.error} onRetry={sessions.reload} />}
          {!sessions.loading && !sessions.error && (
            <Table
              columns={['User', 'NAS', 'IP sesi', 'Mulai', 'Durasi', 'Masuk', 'Keluar', 'Caller ID']}
              isEmpty={(sessions.data?.length ?? 0) === 0}
              empty="Tidak ada sesi RADIUS aktif."
            >
              {(sessions.data ?? []).map((row) => (
                <tr key={row.radacctid} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.username}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.nasipaddress ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.framedipaddress ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{formatTime(row.acctstarttime)}</td>
                  <td className="px-3 py-2 text-slate-300">{formatUptime(row.acctsessiontime)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{formatBytes(row.acctinputoctets)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{formatBytes(row.acctoutputoctets)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.callingstationid ?? '-'}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {accounting.loading && <Loading />}
          {accounting.error && <ErrorNote message={accounting.error} onRetry={accounting.reload} />}
          {!accounting.loading && !accounting.error && (
            <Table
              columns={['User', 'NAS', 'Mulai', 'Selesai', 'Durasi', 'Trafik', 'Penyebab berhenti']}
              isEmpty={(accounting.data?.length ?? 0) === 0}
              empty="Belum ada catatan akuntansi."
            >
              {(accounting.data ?? []).map((row) => (
                <tr key={row.radacctid} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.username}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.nasipaddress ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{formatTime(row.acctstarttime)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">
                    {row.acctstoptime ? formatTime(row.acctstoptime) : <Badge tone="good">berjalan</Badge>}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{formatUptime(row.acctsessiontime)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">
                    ↓ {formatBytes(row.acctinputoctets)} · ↑ {formatBytes(row.acctoutputoctets)}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{row.acctterminatecause ?? '-'}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      <div className="mt-4">
        <Card>
          <p className="text-xs text-slate-400">
            Durasi dihitung FreeRADIUS dari paket akuntansi MikroTik (interim-update). Bila akuntansi belum diaktifkan
            di menu <code className="text-slate-300">/radius</code> perangkat, tabel ini akan tetap kosong meski user
            berhasil login.
          </p>
        </Card>
      </div>
    </div>
  );
};

export default Sesi;
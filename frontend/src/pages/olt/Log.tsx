import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ErrorNote,
  Loading,
  PageHeader,
  Table,
  Toolbar,
  useNet,
} from '../../components/net/NetUI';
import { RowActions } from '../../components/table/RowActions';
import { TablePager } from '../../components/TablePager';
import api from '../../services/api';

/**
 * Log ONU — event syslog ONU yang diterima kolektor dari OLT.
 *
 * Berbeda dari "Inventori ONU" (snapshot status terkini): halaman ini menampilkan
 * ALUR kejadian (linkup/linkdown/registrasi/dying gasp/login) per ONU, dari
 * tabel `olt_syslog_events`. Diambil per halaman dari server; kolom log mentah
 * ditampilkan satu baris (truncate) dengan keterangan penuh saat di-hover.
 */

interface LogRow {
  id: number;
  olt_id: number | null;
  olt_name: string | null;
  olt_name_display: string | null;
  source_ip: string;
  event_type: string;
  port_id: string | null;
  onu_id: string | null;
  onu_mac: string | null;
  onu_name: string | null;
  raw_log: string;
  created_at: string;
}

interface LogPayload {
  rows: LogRow[];
  total: number;
}

interface DevicePayload {
  rows: Array<{ id: number; name: string }>;
}

const EVENT_TYPES = [
  'ONU_LINKUP',
  'ONU_LINKDOWN',
  'ONU_REGISTER',
  'ONU_DEREGISTER',
  'ONU_DYING_GASP',
  'LOGIN',
  'LOGOUT',
  'UNKNOWN',
] as const;

const EVENT_TONE: Record<string, 'good' | 'bad' | 'warn' | 'mute'> = {
  ONU_LINKUP: 'good',
  ONU_REGISTER: 'good',
  ONU_LINKDOWN: 'bad',
  ONU_DEREGISTER: 'bad',
  ONU_DYING_GASP: 'bad',
  LOGIN: 'warn',
  LOGOUT: 'mute',
  UNKNOWN: 'mute',
};

const waktu = (value: string | null) =>
  value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' }) : '—';

const LogOnu: React.FC = () => {
  const devices = useNet<DevicePayload>('/api/olt/devices');
  const [oltId, setOltId] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);

  // Pemilihan untuk hapus massal.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<LogRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Perubahan filter kembali ke halaman pertama; hapus massal melintasi halaman,
  // jadi pilihan dibiarkan (bisa jadi menyangkut baris yang sudah tak tampil).
  useEffect(() => {
    setPage(1);
  }, [oltId, type, search, size]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (oltId) params.set('olt_id', oltId);
    if (type) params.set('type', type);
    if (search.trim()) params.set('search', search.trim());
    params.set('page', String(page));
    params.set('size', String(size));
    return `/api/olt/syslog/events?${params.toString()}`;
  }, [oltId, type, search, page, size]);

  const logs = useNet<LogPayload>(query);
  const rows = logs.data?.rows ?? [];
  const total = logs.data?.total ?? 0;

  const readError = (error: unknown, fallback: string): string => {
    const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    return typeof message === 'string' && message.length > 0 ? message : fallback;
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) rows.forEach((row) => next.delete(row.id));
      else rows.forEach((row) => next.add(row.id));
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0 || busy) return;
    if (!window.confirm(`Hapus ${selected.size} log ONU yang dipilih? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await api.post('/api/olt/syslog/events/delete', { ids: [...selected] });
      const removed = (response.data as { removed: number }).removed ?? 0;
      setNotice({ tone: 'ok', text: `${removed} log dihapus.` });
      setSelected(new Set());
      logs.reload();
    } catch (error) {
      setNotice({ tone: 'bad', text: readError(error, 'Gagal menghapus log.') });
    } finally {
      setBusy(false);
    }
  };

  const hapusSatu = async (row: LogRow) => {
    if (!window.confirm('Hapus log ini?')) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.post('/api/olt/syslog/events/delete', { ids: [row.id] });
      setNotice({ tone: 'ok', text: 'Log dihapus.' });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      logs.reload();
    } catch (error) {
      setNotice({ tone: 'bad', text: readError(error, 'Gagal menghapus log.') });
    } finally {
      setBusy(false);
    }
  };

  if (devices.loading && logs.loading) return <Loading label="Memuat log ONU…" />;

  return (
    <div className="page-container">
      <PageHeader
        title="Log ONU"
        subtitle="Alur kejadian ONU yang diterima dari OLT (linkup, linkdown, registrasi, dying gasp, login). Sumber: kolektor syslog internal."
        actions={
          <Button onClick={logs.reload} disabled={logs.refreshing}>
            {logs.refreshing ? 'Memuat…' : 'Muat ulang'}
          </Button>
        }
      />

      {logs.error && <ErrorNote message={logs.error} onRetry={logs.reload} />}

      {notice && (
        <div
          className={`mb-3 rounded-lg border px-4 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/40 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <Toolbar>
        <select
          value={oltId}
          onChange={(event) => setOltId(event.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          <option value="">Semua perangkat</option>
          {(devices.data?.rows ?? []).map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>

        <select
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          <option value="">Semua tipe</option>
          {EVENT_TYPES.map((eventType) => (
            <option key={eventType} value={eventType}>
              {eventType}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari ONU, MAC, PON, atau isi log…"
          className="w-full max-w-xs rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        />

        {rows.length > 0 && (
          <Button onClick={togglePage} disabled={busy}>
            {allPageSelected ? 'Bersihkan pilihan' : 'Pilih halaman ini'}
          </Button>
        )}

        {selected.size > 0 && (
          <Button variant="danger" onClick={deleteSelected} disabled={busy}>
            {busy ? 'Menghapus…' : `Hapus terpilih (${selected.size})`}
          </Button>
        )}
      </Toolbar>

      {logs.loading ? (
        <Loading label="Membaca log…" />
      ) : total === 0 ? (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-6 text-center text-sm text-slate-400">
          Belum ada log ONU. Arahkan Syslog Client OLT ke kolektor internal lewat menu{' '}
          <span className="text-slate-200">Perangkat OLT → Syslog Client</span>.
        </div>
      ) : (
        <div>
          <Table
            columns={[
              '',
              'Waktu',
              'Perangkat',
              'Tipe',
              'PON / ONU',
              'MAC',
              'Nama ONU',
              'Pesan',
              'Aksi',
            ]}
          >
            {/* Baris pemilih massal di atas header kolom isi. */}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-800/40">
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{waktu(row.created_at)}</td>
                <td className="px-3 py-2 text-xs text-slate-300">{row.olt_name_display || row.olt_name || '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={EVENT_TONE[row.event_type] ?? 'mute'}>{row.event_type}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-200">
                  {row.port_id && row.onu_id ? `${row.port_id} / ${row.onu_id}` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-300">{row.onu_mac || '—'}</td>
                <td className="max-w-[160px] truncate px-3 py-2 text-xs text-slate-300" title={row.onu_name ?? undefined}>
                  {row.onu_name || '—'}
                </td>
                <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs text-slate-400" title={row.raw_log}>
                  {row.raw_log}
                </td>
                <td className="actions whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDetail(row)}
                      className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      Detail
                    </button>
                    <RowActions
                      label={`Aksi log ${row.id}`}
                      actions={[
                        { key: 'detail', label: 'Lihat detail', onSelect: () => setDetail(row) },
                        { key: 'delete', label: 'Hapus', tone: 'danger', onSelect: () => void hapusSatu(row) },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </Table>

          <TablePager
            page={page}
            size={size}
            total={total}
            unit="log"
            loading={logs.refreshing}
            onPage={setPage}
            onSize={setSize}
          />
        </div>
      )}

      {detail && <LogDetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
};

const LogDetailModal: React.FC<{ row: LogRow; onClose: () => void }> = ({ row, onClose }) => {
  const baris: Array<[string, React.ReactNode]> = [
    ['Waktu', waktu(row.created_at)],
    ['Perangkat', row.olt_name_display || row.olt_name || '—'],
    ['Hostname OLT', row.olt_name || '—'],
    ['Sumber IP', row.source_ip],
    ['Tipe', row.event_type],
    ['PON / ONU', row.port_id && row.onu_id ? `${row.port_id} / ${row.onu_id}` : '—'],
    ['MAC', row.onu_mac || '—'],
    ['Nama ONU', row.onu_name || '—'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Detail Log ONU</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">#{row.id}</p>
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

        <h3 className="mt-5 text-sm font-semibold text-white">Log mentah</h3>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-slate-700 bg-slate-900/60 p-3 font-mono text-xs text-slate-300">
          {row.raw_log}
        </pre>
      </div>
    </div>
  );
};

export default LogOnu;
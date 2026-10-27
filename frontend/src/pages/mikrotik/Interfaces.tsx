import React, { useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Badge,
  Button,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  SearchInput,
  Table,
  Toolbar,
  errorMessage,
  formatBytes,
  formatNumber,
  useDeviceSelection,
  DeviceBar,
  useNet,
} from '../../components/net/NetUI';
import TrafficPanel from './TrafficPanel';

interface InterfaceRow {
  id: string;
  name: string;
  type: string;
  mtu: number;
  mac_address: string | null;
  running: boolean | null;
  disabled: boolean;
  comment: string;
  tx_bytes: number;
  rx_bytes: number;
}

interface ResourcePayload {
  version: string | null;
  board: string | null;
  architecture: string | null;
  cpu: string | null;
  cpu_count: number;
  cpu_load: number;
  uptime: string | null;
  memory_total_mb: number;
  memory_free_mb: number;
  memory_used_mb: number;
  hdd_total_mb: number;
  hdd_free_mb: number;
}

const Interfaces: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const deviceSel = useDeviceSelection();
  const interfaces = useNet<InterfaceRow[]>('/api/mikrotik/interfaces' + deviceSel.query);
  const resources = useNet<ResourcePayload>('/api/mikrotik/resources' + deviceSel.query);
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  // Filter tipe interface: '' = semua tipe.
  const [typeFilter, setTypeFilter] = useState('');
  const [busyName, setBusyName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Nama interface yang panel traffic-nya sedang terbuka (null = tertutup).
  const [trafficName, setTrafficName] = useState<string | null>(null);

  // Daftar tipe diambil dari data router, bukan daftar tetap, supaya tetap
  // benar pada perangkat yang punya tipe lain (l2tp-out, ovpn, dsb).
  const types = useMemo(() => {
    const list = interfaces.data ?? [];
    const counts = new Map<string, number>();
    for (const row of list) {
      const key = row.type || 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [interfaces.data]);

  const rows = useMemo(() => {
    const list = interfaces.data ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((row) => {
      if (typeFilter && (row.type || 'unknown') !== typeFilter) return false;
      if (onlyActive && !(row.running === true && !row.disabled)) return false;
      if (!needle) return true;
      return `${row.name} ${row.type} ${row.comment}`.toLowerCase().includes(needle);
    });
  }, [interfaces.data, onlyActive, search, typeFilter]);

  const toggle = async (row: InterfaceRow) => {
    setActionError(null);
    const nextDisabled = !row.disabled;
    const label = nextDisabled ? 'menonaktifkan' : 'mengaktifkan';
    if (!window.confirm(`Yakin ${label} interface "${row.name}"? Perubahan langsung dikirim ke perangkat.`)) {
      return;
    }
    setBusyName(row.name);
    try {
      await api.patch(`/api/mikrotik/interfaces/${encodeURIComponent(row.name)}` + deviceSel.query, { disabled: nextDisabled });
      interfaces.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — Interface & Resource"
        subtitle="Daftar interface beserta status link, ditambah ringkasan resource perangkat."
      />

      {resources.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-400">RouterOS</p>
            <p className="text-sm text-slate-100">{resources.data.version ?? '-'}</p>
            <p className="text-xs text-slate-500">{resources.data.board ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-400">CPU</p>
            <p className="text-sm text-slate-100">
              {resources.data.cpu ?? '-'} · {formatNumber(resources.data.cpu_load)}%
            </p>
            <p className="text-xs text-slate-500">{resources.data.cpu_count} core</p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-400">Memori</p>
            <p className="text-sm text-slate-100">
              {formatNumber(resources.data.memory_used_mb)} / {formatNumber(resources.data.memory_total_mb)} MB
            </p>
            <p className="text-xs text-slate-500">bebas {formatNumber(resources.data.memory_free_mb)} MB</p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-400">Disk</p>
            <p className="text-sm text-slate-100">
              {formatNumber(resources.data.hdd_free_mb)} / {formatNumber(resources.data.hdd_total_mb)} MB
            </p>
            <p className="text-xs text-slate-500">uptime {resources.data.uptime ?? '-'}</p>
          </div>
        </div>
      )}

      {interfaces.error && <ErrorNote message={interfaces.error} onRetry={interfaces.reload} />}
      {actionError && <ErrorNote message={actionError} />}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama / tipe interface…" />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <span className="text-xs text-slate-400">Tipe</span>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
          >
            <option value="">Semua tipe</option>
            {types.map(([type, count]) => (
              <option key={type} value={type}>
                {type} ({count})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(event) => setOnlyActive(event.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
          />
          Hanya yang aktif
        </label>
        <span className="text-xs text-slate-500">
          {formatNumber(rows.length)} dari {formatNumber(interfaces.data?.length ?? 0)} interface
        </span>
      </Toolbar>

      {interfaces.loading && <Loading />}

      {!interfaces.loading && !interfaces.error && (
        <Table
          columns={['Nama', 'Tipe', 'Status', 'MTU', 'MAC', 'Traffic', 'Keterangan', isAdmin ? 'Aksi' : '']}
          isEmpty={rows.length === 0}
          empty="Tidak ada interface yang cocok dengan filter."
        >
          {rows.map((row) => (
            <tr key={row.id || row.name} className="hover:bg-slate-700/30">
              <td className="px-3 py-2 font-medium">
                {/* Nama interface bisa diklik untuk melihat rx/tx realtime. */}
                <button
                  type="button"
                  onClick={() => setTrafficName(row.name)}
                  className="text-left text-slate-100 underline decoration-dotted decoration-slate-500 underline-offset-4 hover:text-cyan-300 hover:decoration-cyan-400"
                  title="Lihat traffic realtime"
                >
                  {row.name}
                </button>
              </td>
              <td className="px-3 py-2 text-slate-400">{row.type}</td>
              <td className="px-3 py-2">
                {row.disabled ? (
                  <Badge tone="bad">nonaktif</Badge>
                ) : row.running ? (
                  <Badge tone="good">link up</Badge>
                ) : (
                  <Badge tone="warn">no link</Badge>
                )}
              </td>
              <td className="px-3 py-2 text-slate-300">{row.mtu || '-'}</td>
              <td className="px-3 py-2 text-slate-400 font-mono text-xs">{row.mac_address ?? '-'}</td>
              <td className="px-3 py-2 text-slate-400 text-xs">
                ↓ {formatBytes(row.rx_bytes)} · ↑ {formatBytes(row.tx_bytes)}
              </td>
              <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
              {isAdmin && (
                <td className="px-3 py-2">
                  <Button
                    variant={row.disabled ? 'primary' : 'danger'}
                    disabled={busyName === row.name}
                    onClick={() => toggle(row)}
                  >
                    {busyName === row.name ? '…' : row.disabled ? 'Aktifkan' : 'Nonaktifkan'}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}

      {isAdmin && (
        <div className="mt-3">
          <InfoNote tone="warn">
            Menonaktifkan interface memutus trafik pengguna di interface tersebut. Aksi ini dicatat di audit log
            dan hanya berjalan bila mode tulis MikroTik aktif.
          </InfoNote>
        </div>
      )}

      {trafficName && (
        <TrafficPanel
          name={trafficName}
          deviceQuery={deviceSel.query}
          onClose={() => setTrafficName(null)}
        />
      )}
    </div>
  );
};

export default Interfaces;
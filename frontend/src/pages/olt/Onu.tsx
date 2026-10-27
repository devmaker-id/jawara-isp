import React, { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ErrorNote,
  Loading,
  PageHeader,
  StatCard,
  Table,
  Toolbar,
  formatNumber,
  useNet,
} from '../../components/net/NetUI';

interface OltOnu {
  id: number;
  olt_id: number;
  olt_name: string;
  port_id: string;
  onu_id: string;
  serial_number: string | null;
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
}

interface OnuPayload {
  rows: OltOnu[];
}

interface DevicePayload {
  rows: Array<{ id: number; name: string }>;
}

/**
 * Ambang redaman GPON yang dipakai di lapangan: di atas -25 dBm sehat,
 * -25 sampai -27 dBm perlu dipantau, di bawah -27 dBm rawan putus.
 * Angka ini hanya pewarnaan tampilan, bukan keputusan sistem.
 */
const rxTone = (rx: number | null): 'good' | 'warn' | 'bad' | 'mute' => {
  if (rx === null) return 'mute';
  if (rx >= -25) return 'good';
  if (rx >= -27) return 'warn';
  return 'bad';
};

const dbm = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)} dBm`);

const OnuInventory: React.FC = () => {
  const devices = useNet<DevicePayload>('/api/olt/devices');
  const [oltId, setOltId] = useState('');
  const [online, setOnline] = useState('');
  const [search, setSearch] = useState('');
  const [maxRx, setMaxRx] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (oltId) params.set('olt_id', oltId);
    if (online) params.set('online', online);
    if (search.trim()) params.set('search', search.trim());
    if (maxRx.trim()) params.set('max_rx', maxRx.trim());
    params.set('limit', '2000');
    return `/api/olt/onus?${params.toString()}`;
  }, [oltId, online, search, maxRx]);

  const onus = useNet<OnuPayload>(query);
  const rows = onus.data?.rows ?? [];

  const stats = useMemo(() => {
    const onlineCount = rows.filter((row) => row.online).length;
    const weak = rows.filter((row) => row.rx_power_onu !== null && row.rx_power_onu < -27).length;
    const noSignal = rows.filter((row) => row.online && row.rx_power_onu === null).length;
    return { total: rows.length, online: onlineCount, offline: rows.length - onlineCount, weak, noSignal };
  }, [rows]);

  if (devices.loading && onus.loading) return <Loading label="Memuat inventori ONU…" />;

  return (
    <div className="page-container">
      <PageHeader
        title="Inventori ONU"
        subtitle="Data hasil pembacaan terakhir dari perangkat. Angka di sini tidak diambil dari MikroTik maupun billing — sumbernya OLT."
        actions={
          <Button onClick={onus.reload} disabled={onus.refreshing}>
            {onus.refreshing ? 'Memuat…' : 'Muat ulang'}
          </Button>
        }
      />

      {onus.error && <ErrorNote message={onus.error} onRetry={onus.reload} />}

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <StatCard label="ONU ditampilkan" value={formatNumber(stats.total)} />
        <StatCard label="Online" value={formatNumber(stats.online)} tone="good" />
        <StatCard label="Offline" value={formatNumber(stats.offline)} tone={stats.offline ? 'warn' : 'default'} />
        <StatCard
          label="Redaman lemah"
          value={formatNumber(stats.weak)}
          tone={stats.weak ? 'bad' : 'default'}
          hint="Di bawah -27 dBm"
        />
      </div>

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
          value={online}
          onChange={(event) => setOnline(event.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          <option value="">Online &amp; offline</option>
          <option value="true">Hanya online</option>
          <option value="false">Hanya offline</option>
        </select>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari ONU ID, serial, atau deskripsi…"
          className="w-full max-w-xs rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        />

        <input
          value={maxRx}
          onChange={(event) => setMaxRx(event.target.value)}
          placeholder="Redaman ≤ (mis. -25)"
          inputMode="decimal"
          className="w-40 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
        />
      </Toolbar>

      {onus.loading ? (
        <Loading label="Membaca inventori…" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-6 text-center text-sm text-slate-400">
          Belum ada data ONU. Buka menu <span className="text-slate-200">Perangkat OLT</span> lalu tekan
          tombol <span className="text-slate-200">Sinkron</span> pada perangkatnya.
        </div>
      ) : (
        <Table
          columns={['Perangkat', 'PON / ONU', 'Serial', 'Deskripsi', 'Status', 'Rx ONU', 'Rx OLT', 'Suhu']}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-800/40">
              <td className="px-3 py-2 text-xs text-slate-300">{row.olt_name}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-200">
                {row.port_id} / {row.onu_id}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.serial_number ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-300">{row.description || '—'}</td>
              <td className="px-3 py-2">
                {row.online ? (
                  <Badge tone="good">online</Badge>
                ) : (
                  <Badge tone="bad">{row.phase_state || 'offline'}</Badge>
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  admin {row.admin_state ?? '—'}
                </p>
              </td>
              <td className="px-3 py-2">
                <Badge tone={rxTone(row.rx_power_onu)}>{dbm(row.rx_power_onu)}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-400">{dbm(row.rx_power_olt)}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-400">
                {row.temperature === null ? '—' : `${row.temperature.toFixed(1)} °C`}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

export default OnuInventory;
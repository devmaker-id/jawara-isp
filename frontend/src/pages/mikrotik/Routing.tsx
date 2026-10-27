import React, { useMemo, useState } from 'react';
import { TablePager, useTablePager } from '../../components/TablePager';
import {
  Badge,
  Button,
  ErrorNote,
  Loading,
  PageHeader,
  SearchInput,
  StatCard,
  Table,
  Tabs,
  Toolbar,
  formatNumber,
  useDeviceSelection,
  DeviceBar,
  useNet,
} from '../../components/net/NetUI';

interface RouteRow {
  id: string;
  dst_address: string;
  gateway: string;
  distance: number;
  active: boolean;
  static: boolean;
  disabled: boolean;
  comment: string;
}

interface NeighborRow {
  id: string;
  interface: string;
  address: string;
  address4: string;
  identity: string;
  platform: string;
  version: string;
  uptime: string;
}

interface ArpRow {
  id: string;
  address: string;
  mac_address: string;
  interface: string;
  dynamic: boolean;
  disabled: boolean;
  comment: string;
}

const Routing: React.FC = () => {
  const [tab, setTab] = useState('routes');
  const [search, setSearch] = useState('');

  const deviceSel = useDeviceSelection();
  const routes = useNet<RouteRow[]>('/api/mikrotik/routing/routes' + deviceSel.query);
  const neighbors = useNet<NeighborRow[]>('/api/mikrotik/routing/neighbors' + deviceSel.query);
  const arp = useNet<ArpRow[]>('/api/mikrotik/routing/arp' + deviceSel.query);

  const needle = search.trim().toLowerCase();

  const filteredRoutes = useMemo(
    () =>
      (routes.data ?? []).filter((row) =>
        !needle ? true : `${row.dst_address} ${row.gateway} ${row.comment}`.toLowerCase().includes(needle),
      ),
    [routes.data, needle],
  );
  const filteredNeighbors = useMemo(
    () =>
      (neighbors.data ?? []).filter((row) =>
        !needle
          ? true
          : `${row.identity} ${row.address} ${row.address4} ${row.interface} ${row.platform}`.toLowerCase().includes(needle),
      ),
    [neighbors.data, needle],
  );
  const filteredArp = useMemo(
    () =>
      (arp.data ?? []).filter((row) =>
        !needle ? true : `${row.address} ${row.mac_address} ${row.interface} ${row.comment}`.toLowerCase().includes(needle),
      ),
    [arp.data, needle],
  );

  // ARP bisa ratusan entri dan route bisa lebih banyak dari satu layar;
  // ketiganya dipotong per halaman.
  const routePager = useTablePager(filteredRoutes, 25);
  const neighborPager = useTablePager(filteredNeighbors, 25);
  const arpPager = useTablePager(filteredArp, 25);

  const defaultRoutes = (routes.data ?? []).filter((row) => row.dst_address === '0.0.0.0/0');

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — Routing & ARP"
        subtitle="Tabel routing IPv4, tetangga MNDP, dan entri ARP. Semua data dibaca langsung dari perangkat (read-only)."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total route" value={formatNumber(routes.data?.length)} />
        <StatCard
          label="Default route"
          value={defaultRoutes.length > 0 ? defaultRoutes.map((row) => row.gateway).join(', ') : '-'}
          hint="dst-address 0.0.0.0/0"
        />
        <StatCard label="Tetangga" value={formatNumber(neighbors.data?.length)} hint="MNDP / neighbor discovery" />
        <StatCard label="Entri ARP" value={formatNumber(arp.data?.length)} />
      </div>

      <Tabs
        tabs={[
          { key: 'routes', label: 'Routes', count: routes.data?.length },
          { key: 'neighbors', label: 'Tetangga', count: neighbors.data?.length },
          { key: 'arp', label: 'ARP', count: arp.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Cari alamat / gateway / interface…" />
      </Toolbar>

      {tab === 'routes' && (
        <>
          {routes.loading && <Loading />}
          {routes.error && <ErrorNote message={routes.error} onRetry={routes.reload} />}
          {!routes.loading && !routes.error && (
            <Table
              columns={['Tujuan', 'Gateway', 'Distance', 'Status', 'Tipe', 'Komentar']}
              isEmpty={filteredRoutes.length === 0}
              empty="Tidak ada route yang cocok."
            >
              {routePager.pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-mono text-xs text-slate-100">{row.dst_address}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.gateway}</td>
                  <td className="px-3 py-2 text-slate-400">{row.distance}</td>
                  <td className="px-3 py-2">
                    {row.disabled ? (
                      <Badge tone="bad">nonaktif</Badge>
                    ) : row.active ? (
                      <Badge tone="good">aktif</Badge>
                    ) : (
                      <Badge tone="mute">tidak aktif</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{row.static ? 'static' : 'dynamic'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
                </tr>
              ))}
            </Table>
          )}
          {filteredRoutes.length > 0 && <TablePager unit="route" {...routePager.pagerProps} />}
        </>
      )}

      {tab === 'neighbors' && (
        <>
          {neighbors.loading && <Loading />}
          {neighbors.error && <ErrorNote message={neighbors.error} onRetry={neighbors.reload} />}
          {!neighbors.loading && !neighbors.error && (
            <Table
              columns={['Identitas', 'Alamat', 'IPv4', 'Interface', 'Platform', 'Versi', 'Uptime']}
              isEmpty={filteredNeighbors.length === 0}
              empty="Tidak ada tetangga terdeteksi (MNDP bisa nonaktif di perangkat lain)."
            >
              {neighborPager.pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.identity || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.address || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.address4 || '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.interface || '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.platform || '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.version || '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.uptime || '-'}</td>
                </tr>
              ))}
            </Table>
          )}
          {filteredNeighbors.length > 0 && (
            <TablePager unit="tetangga" {...neighborPager.pagerProps} />
          )}
        </>
      )}

      {tab === 'arp' && (
        <>
          {arp.loading && <Loading />}
          {arp.error && <ErrorNote message={arp.error} onRetry={arp.reload} />}
          {!arp.loading && !arp.error && (
            <Table
              columns={['Alamat IP', 'MAC', 'Interface', 'Tipe', 'Komentar']}
              isEmpty={filteredArp.length === 0}
              empty="Tidak ada entri ARP yang cocok."
            >
              {arpPager.pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-mono text-xs text-slate-100">{row.address}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.mac_address || '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.interface}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {row.dynamic ? 'dynamic' : 'static'}
                    {row.disabled && ' · nonaktif'}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
                </tr>
              ))}
            </Table>
          )}
          {filteredArp.length > 0 && <TablePager unit="entri ARP" {...arpPager.pagerProps} />}
        </>
      )}
    </div>
  );
};

export default Routing;
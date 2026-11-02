import React, { useEffect, useMemo, useState } from 'react';
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
import { TablePager } from '../../components/TablePager';
import api from '../../services/api';

interface OltOnu {
  id: number;
  olt_id: number;
  olt_name: string;
  /** Pelanggan pemilik ONU; null = masih inventaris. */
  customer_id: number | null;
  customer_name?: string | null;
  internet_no?: string | null;
  port_id: string;
  onu_id: string;
  serial_number: string | null;
  onu_mac: string | null;
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
  page: number;
  size: number;
  total: number;
  stats: { online: number; offline: number; weak: number };
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
  const [assigned, setAssigned] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);

  // Pemasangan ONU: dialog kecil, bukan halaman baru.
  const [target, setTarget] = useState<OltOnu | null>(null);
  const [internetNo, setInternetNo] = useState('');
  const [allowMove, setAllowMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Setiap perubahan filter mengembalikan tampilan ke halaman 1: kalau tidak,
  // operator bisa mendarat di halaman yang sudah tidak ada isinya.
  useEffect(() => {
    setPage(1);
  }, [oltId, online, search, maxRx, assigned, size]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (oltId) params.set('olt_id', oltId);
    if (online) params.set('online', online);
    if (search.trim()) params.set('search', search.trim());
    if (maxRx.trim()) params.set('max_rx', maxRx.trim());
    if (assigned) params.set('assigned', assigned);
    params.set('page', String(page));
    params.set('size', String(size));
    return `/api/olt/onus?${params.toString()}`;
  }, [oltId, online, search, maxRx, assigned, page, size]);

  // Satu permintaan per halaman: browser tidak pernah menerima seluruh
  // inventori sekaligus, berapa pun jumlah ONU di perangkat.
  const onus = useNet<OnuPayload>(query);
  const rows = onus.data?.rows ?? [];
  const total = onus.data?.total ?? 0;
  const stats = onus.data?.stats ?? { online: 0, offline: 0, weak: 0 };

  const readError = (error: unknown, fallback: string): string => {
    const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    return typeof message === 'string' && message.length > 0 ? message : fallback;
  };

  const openAssign = (row: OltOnu) => {
    setTarget(row);
    setInternetNo(row.internet_no ?? '');
    // ONU yang sudah terpasang di pelanggan lain hanya bisa dipindah bila
    // operator menyatakan sendiri — tidak pernah dipindah diam-diam.
    setAllowMove(false);
    setNotice(null);
  };

  const submitAssign = async () => {
    if (!target || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.post(`/api/olt/onus/${target.id}/assign`, {
        internet_no: internetNo.trim(),
        move: allowMove,
      });
      setNotice({ tone: 'ok', text: `ONU ${target.serial_number ?? `#${target.id}`} terpasang.` });
      setTarget(null);
      onus.reload();
    } catch (error) {
      setNotice({ tone: 'bad', text: readError(error, 'Gagal memasang ONU.') });
    } finally {
      setBusy(false);
    }
  };

  const release = async (row: OltOnu) => {
    const label = row.serial_number || row.onu_mac || `#${row.id}`;
    if (!window.confirm(`Lepas ONU ${label} dari pelanggan? ONU tetap tersimpan sebagai inventaris.`)) return;
    try {
      await api.post(`/api/olt/onus/${row.id}/release`, {});
      setNotice({ tone: 'ok', text: `ONU ${label} dilepas, kembali jadi inventaris.` });
      onus.reload();
    } catch (error) {
      setNotice({ tone: 'bad', text: readError(error, 'Gagal melepas ONU.') });
    }
  };

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
        <StatCard label="ONU (sesuai filter)" value={formatNumber(total)} />
        <StatCard label="Online" value={formatNumber(stats.online)} tone="good" />
        <StatCard label="Offline" value={formatNumber(stats.offline)} tone={stats.offline ? 'warn' : 'default'} />
        <StatCard
          label="Redaman lemah"
          value={formatNumber(stats.weak)}
          tone={stats.weak ? 'bad' : 'default'}
          hint="Di bawah -27 dBm"
        />
      </div>

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
          value={online}
          onChange={(event) => setOnline(event.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          <option value="">Online &amp; offline</option>
          <option value="true">Hanya online</option>
          <option value="false">Hanya offline</option>
        </select>

        <select
          value={assigned}
          onChange={(event) => setAssigned(event.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          <option value="">Semua ONU</option>
          <option value="true">Sudah terpasang</option>
          <option value="false">Masih inventaris</option>
        </select>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari ONU ID, serial/MAC, atau deskripsi…"
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
      ) : total === 0 ? (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-6 text-center text-sm text-slate-400">
          Belum ada data ONU. Buka menu <span className="text-slate-200">Perangkat OLT</span> lalu tekan
          tombol <span className="text-slate-200">Sinkron</span> pada perangkatnya.
        </div>
      ) : (
        <div>
          <Table
            columns={[
              'Perangkat',
              'PON / ONU',
              'Serial / MAC',
              'Deskripsi',
              'Pelanggan',
              'Status',
              'Rx ONU',
              'Rx OLT',
              'Suhu',
              'Aksi',
            ]}
          >
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-800/40">
                <td className="px-3 py-2 text-xs text-slate-300">{row.olt_name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-200">
                  {row.port_id} / {row.onu_id}
                </td>
                {/* VSOL memberi serial GPON; HiFocus memberi MAC ONU. Keduanya
                    ditampilkan apa adanya, tidak dicampur dalam satu arti. */}
                <td className="px-3 py-2 font-mono text-xs text-slate-300">
                  {row.serial_number || row.onu_mac || '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-300">{row.description || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {row.customer_id ? (
                    <div className="leading-tight">
                      <div className="text-slate-200">{row.customer_name}</div>
                      <div className="font-mono text-[11px] text-cyan-300">{row.internet_no}</div>
                    </div>
                  ) : (
                    <span className="text-slate-500">inventaris</span>
                  )}
                </td>
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
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {dbm(row.rx_power_olt)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {row.temperature === null ? '—' : `${row.temperature.toFixed(1)} °C`}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {row.customer_id ? (
                    <button
                      type="button"
                      onClick={() => release(row)}
                      className="text-xs font-medium text-red-400 hover:text-red-300"
                    >
                      Lepas
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAssign(row)}
                      className="text-xs font-medium text-cyan-400 hover:text-cyan-300"
                    >
                      Pasang
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          <TablePager
            page={onus.data?.page ?? page}
            size={onus.data?.size ?? size}
            total={total}
            unit="ONU"
            loading={onus.refreshing}
            onPage={setPage}
            onSize={setSize}
          />
        </div>
      )}

      {target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <div>
              <h2 id="assign-title" className="text-lg font-semibold text-white">
                Pasang ONU ke pelanggan
              </h2>
              <p className="mt-1 font-mono text-xs text-slate-400">
                {target.olt_name} · {target.port_id}/{target.onu_id} ·{' '}
                {target.serial_number || target.onu_mac || '—'}
              </p>
            </div>

            <div>
              <label htmlFor="assign-internet-no" className="mb-1 block text-sm font-medium text-slate-300">
                Nomor Internet pelanggan *
              </label>
              <input
                id="assign-internet-no"
                value={internetNo}
                onChange={(event) => setInternetNo(event.target.value)}
                placeholder="1312013"
                inputMode="numeric"
                className="w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Nomor Internet permanen pelanggan (bukan username RADIUS).
              </p>
            </div>

            {target.customer_id !== null && (
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={allowMove}
                  onChange={(event) => setAllowMove(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Pindahkan ONU ini dari {target.customer_name} ({target.internet_no}) ke pelanggan
                  yang diisi di atas.
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setTarget(null)} disabled={busy}>
                Batal
              </Button>
              <Button onClick={submitAssign} disabled={busy || !internetNo.trim()}>
                {busy ? 'Menyimpan…' : 'Pasang'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnuInventory;
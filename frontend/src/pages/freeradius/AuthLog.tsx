import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { useBackgroundRefresh } from '../../hooks/useBackgroundRefresh';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  Table,
  errorMessage,
  formatNumber,
} from '../../components/net/NetUI';

// Halaman Log Autentikasi FreeRADIUS.
//
// Sumber data: tabel radpostauth. Kolom identitas perangkat (IP NAS, MAC,
// interface, station) diisi oleh query post-auth di sisi FreeRADIUS — panel
// hanya membaca dan memfilter.

interface AuthLogRow {
  id: number;
  username: string;
  reply: string;
  callingstationid: string | null;
  calledstationid: string | null;
  nasipaddress: string | null;
  nasportid: string | null;
  nasporttype: string | null;
  framedipaddress: string | null;
  authdate: string;
}

interface AuthLogPayload {
  rows: AuthLogRow[];
  total: number;
  page: number;
  limit: number;
  facets: { nas: string[]; interfaces: string[]; replies: string[] };
}

const formatTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
};

const toneOf = (reply: string) =>
  reply === 'Access-Accept' ? 'good' : reply === 'Access-Challenge' ? 'warn' : 'bad';

const emptyFacets = { nas: [], interfaces: [], replies: [] };

const AuthLog: React.FC = () => {
  const [data, setData] = useState<AuthLogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan di
  // belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [mac, setMac] = useState('');
  const [station, setStation] = useState('');
  const [nas, setNas] = useState('');
  const [iface, setIface] = useState('');
  const [reply, setReply] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const response = await api.get<AuthLogPayload>('/api/freeradius/auth-log', {
        params: {
          search: search.trim() || undefined,
          mac: mac.trim() || undefined,
          station: station.trim() || undefined,
          nas: nas || undefined,
          iface: iface || undefined,
          reply: reply || undefined,
          page,
          limit: 100,
        },
      });
      setData(response.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, mac, station, nas, iface, reply, page]);

  // Ketikan difilter ~350 ms supaya tidak membanjiri API.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 350);
    return () => clearTimeout(timer);
  }, [load]);

  // Log autentikasi ikut menyegarkan diri di belakang layar.
  useBackgroundRefresh(load, { intervalMs: 30000 });

  // Setiap perubahan filter kembali ke halaman pertama.
  useEffect(() => {
    setPage(1);
  }, [search, mac, station, nas, iface, reply]);

  const facets = data?.facets ?? emptyFacets;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 100;
  const pageCount = Math.max(Math.ceil(total / limit), 1);

  const reset = () => {
    setSearch('');
    setMac('');
    setStation('');
    setNas('');
    setIface('');
    setReply('');
  };

  const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100';

  return (
    <div className="page-container">
      <PageHeader
        title="FreeRADIUS — Log Autentikasi"
        subtitle="Hasil autentikasi terakhir beserta IP NAS, MAC, interface, dan station."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      <Card className="mb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Cari user / MAC / IP klien</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="mis. 18:02:AE atau 192.150"
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">MAC (calling-station)</span>
            <input
              value={mac}
              onChange={(event) => setMac(event.target.value)}
              placeholder="AA:BB:CC"
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Station (called-station)</span>
            <input
              value={station}
              onChange={(event) => setStation(event.target.value)}
              placeholder="mis. JMNET-WIFI"
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">NAS (IP)</span>
            <select value={nas} onChange={(event) => setNas(event.target.value)} className={field}>
              <option value="">Semua NAS</option>
              {facets.nas.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Interface (NAS-Port-Id)</span>
            <select value={iface} onChange={(event) => setIface(event.target.value)} className={field}>
              <option value="">Semua interface</option>
              {facets.interfaces.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Hasil</span>
            <select value={reply} onChange={(event) => setReply(event.target.value)} className={field}>
              <option value="">Semua hasil</option>
              {facets.replies.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button onClick={reset}>Bersihkan filter</Button>
          </div>
        </div>
      </Card>

      {loading && !data && <Loading label="Memuat log autentikasi…" />}

      {data && (
        <>
          <p className="mb-2 text-xs text-slate-400">
            {formatNumber(total)} baris · halaman {page} dari {pageCount}
            {loading ? ' · memuat…' : ''}
          </p>

          <Table
            columns={['Waktu', 'User', 'Hasil', 'MAC', 'Station', 'IP klien', 'NAS', 'Interface', 'Tipe port']}
            isEmpty={rows.length === 0}
            empty="Belum ada log autentikasi yang cocok."
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                  {formatTime(row.authdate)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-200">{row.username}</td>
                <td className="px-3 py-2">
                  <Badge tone={toneOf(row.reply)}>{row.reply.replace('Access-', '')}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">
                  {row.callingstationid || '-'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-300">{row.calledstationid || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">
                  {row.framedipaddress || '-'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.nasipaddress || '-'}</td>
                <td className="px-3 py-2 text-xs text-slate-300">{row.nasportid || '-'}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{row.nasporttype || '-'}</td>
              </tr>
            ))}
          </Table>

          <div className="mt-3 flex items-center gap-2">
            <Button onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1}>
              Sebelumnya
            </Button>
            <Button
              onClick={() => setPage((current) => Math.min(current + 1, pageCount))}
              disabled={page >= pageCount}
            >
              Berikutnya
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default AuthLog;

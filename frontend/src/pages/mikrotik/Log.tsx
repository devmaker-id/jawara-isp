import React, { useMemo, useState } from 'react';
import { TablePager, useTablePager } from '../../components/TablePager';
import {
  Badge,
  Button,
  Card,
  DeviceBar,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  SearchInput,
  Table,
  Toolbar,
  formatNumber,
  useDeviceSelection,
  useNet,
} from '../../components/net/NetUI';

interface LogRow {
  seq: number;
  time: string;
  topics: string;
  message: string;
}

interface LogPayload {
  device_id: number;
  rows: LogRow[];
  matched: number;
  total: number;
  truncated: boolean;
  topics: Array<{ topic: string; count: number }>;
}

// Topik yang biasanya paling dicari operator, ditampilkan lebih dulu bila ada
// di perangkat. Sisanya menyusul sesuai isi log.
const PRIORITAS = ['error', 'warning', 'critical', 'wireless', 'radius', 'pppoe', 'dhcp', 'system'];

/** Warna per tingkat kepentingan topik. */
const toneFor = (topics: string): 'good' | 'warn' | 'bad' | 'mute' => {
  const list = topics.toLowerCase();
  if (list.includes('error') || list.includes('critical')) return 'bad';
  if (list.includes('warning')) return 'warn';
  if (list.includes('account') || list.includes('info')) return 'good';
  return 'mute';
};

const LogAktivitas: React.FC = () => {
  const deviceSel = useDeviceSelection();
  const [topic, setTopic] = useState<string>('');
  const [search, setSearch] = useState('');
  const [auto, setAuto] = useState(false);

  // Satu permintaan mengambil seluruh isi buffer log perangkat; penyaringan
  // topik dan pencarian dilakukan di browser supaya mengklik filter tidak
  // menambah koneksi API baru ke router.
  const { data, loading, refreshing, error, reload } = useNet<LogPayload>(
    `/api/mikrotik/logs?limit=1000${deviceSel.deviceId ? `&device=${deviceSel.deviceId}` : ''}`,
    true,
    { refreshMs: auto ? 30_000 : 0 },
  );

  const topics = useMemo(() => {
    const list = data?.topics ?? [];
    const rank = (name: string) => {
      const index = PRIORITAS.indexOf(name);
      return index === -1 ? PRIORITAS.length : index;
    };
    return [...list].sort((a, b) => rank(a.topic) - rank(b.topic) || b.count - a.count);
  }, [data]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((row) => {
      if (topic && !row.topics.split(',').some((item) => item.trim() === topic)) return false;
      if (!needle) return true;
      return (
        row.message.toLowerCase().includes(needle) ||
        row.topics.toLowerCase().includes(needle) ||
        row.time.toLowerCase().includes(needle)
      );
    });
  }, [data, topic, search]);

  // Log diambil sekali (satu koneksi ke router), lalu ditampilkan per halaman:
  // 1000 baris DOM membuat browser tersendat, dan operator tidak membacanya
  // sekaligus.
  const pager = useTablePager(rows, 50);

  if (loading) return <Loading label="Membaca log perangkat…" />;

  return (
    <div className="page-container">
      <PageHeader
        title="Log Aktivitas"
        subtitle="Isi log perangkat MikroTik apa adanya: login, perubahan konfigurasi, klien hotspot/PPP, dan pesan sistem. Hanya dibaca saat halaman ini dibuka."
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={auto}
                onChange={(event) => setAuto(event.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900"
              />
              muat ulang tiap 30 detik
            </label>
            <Button onClick={reload} disabled={refreshing}>
              {refreshing ? 'Memuat…' : 'Muat ulang'}
            </Button>
          </>
        }
      />

      <DeviceBar selection={deviceSel} />

      {error && <ErrorNote message={error} onRetry={reload} />}

      {data && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400">Baris di perangkat</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatNumber(data.total)}
                <span className="ml-1 text-xs font-normal text-slate-400">baris</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {data.truncated
                  ? `Buffer penuh — ${formatNumber(data.matched)} baris, ditampilkan terbaru.`
                  : 'Seluruh buffer log perangkat terbaca.'}
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400">Ditampilkan</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatNumber(rows.length)}
                <span className="ml-1 text-xs font-normal text-slate-400">baris</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {topic || search ? 'Setelah filter/pencarian.' : 'Terbaru di atas.'}
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400">Topik tersedia</p>
              <p className="mt-1 text-lg font-semibold text-white">{topics.length}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Dari isi log, bukan daftar tetap.
              </p>
            </Card>
          </div>

          <Toolbar>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Cari pesan, topik, atau waktu…"
            />
            <button
              type="button"
              onClick={() => setTopic('')}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                topic === ''
                  ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-600 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              Semua
            </button>
            {topics.map((item) => (
              <button
                key={item.topic}
                type="button"
                onClick={() => setTopic(item.topic === topic ? '' : item.topic)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  item.topic === topic
                    ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-600 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                {item.topic}
                <span className="ml-1 text-slate-500">{item.count}</span>
              </button>
            ))}
          </Toolbar>

          {data.rows.length === 0 ? (
            <InfoNote tone="warn">
              Log perangkat masih kosong. RouterOS menyimpan log di memori (dan disk bila
              dikonfigurasi); periksa <code>/log print</code> di perangkat.
            </InfoNote>
          ) : (
            <Table
              columns={['Waktu', 'Topik', 'Pesan']}
              isEmpty={rows.length === 0}
              empty="Tidak ada baris yang cocok dengan filter."
            >
              {pager.pageRows.map((row) => (
                <tr key={row.seq} className="align-top hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-400">
                    {row.time}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge tone={toneFor(row.topics)}>{row.topics}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-200 break-words">
                    {row.message}
                  </td>
                </tr>
              ))}
            </Table>
          )}

          {rows.length > 0 && (
            <TablePager unit="baris" {...pager.pagerProps} />
          )}
        </>
      )}
    </div>
  );
};

export default LogAktivitas;
import React, { useCallback, useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import {
  Card,
  ErrorNote,
  Loading,
  errorMessage,
  formatBytes,
  formatUptime,
} from '../components/net/NetUI';

interface ServerMetrics {
  uptime_seconds: number;
  cpu_count: number;
  cpu_percent: number | null;
  processes: number;
  mem_total: number;
  mem_used: number;
  disk_total: number;
  disk_used: number;
}

interface OnlineCounts {
  hotspot: number | null;
  ppp: number | null;
  /** Sesi terbuka yang belum bisa dipastikan hotspot atau PPP. */
  unclassified: number;
  device: string | null;
  error: string | null;
}

interface AuthHealth {
  accept: number;
  reject: number;
  total: number;
  reject_percent: number;
  /** Penolakan berupa percobaan MAC (halaman login hotspot), bukan akun. */
  reject_mac: number;
  /** Penolakan dengan username akun sungguhan. */
  reject_account: number;
  top_rejected: Array<{ username: string; count: number }>;
  error: string | null;
}

interface ExpiringAccount {
  username: string;
  profile_name: string;
  profile_type: 'hotspot' | 'ppp';
  expires_at: string;
  days_left: number;
}

interface ExpiringSoon {
  overdue: number;
  in_24h: number;
  in_3d: number;
  without_expiry: number;
  rows: ExpiringAccount[];
  error: string | null;
}

interface VoucherProfileRow {
  profile_name: string;
  profile_type: 'hotspot' | 'ppp';
  created: number;
  ready: number;
  used: number;
  expired: number;
  total: number;
}

interface DashboardData {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
  server: ServerMetrics;
  online: OnlineCounts;
  auth: AuthHealth;
  expiring: ExpiringSoon;
  vouchers: VoucherProfileRow[];
}

const rupiah = (value: number) => `Rp ${value.toLocaleString('id-ID')}`;

const percent = (used: number, total: number) =>
  total > 0 ? Math.round((used / total) * 100) : 0;

const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

/** Sisa waktu dalam bahasa sehari-hari; negatif berarti sudah lewat. */
const sisaWaktu = (days: number) => {
  if (days < 0) return `lewat ${Math.abs(days)} hari`;
  if (days === 0) return 'kurang dari 1 hari';
  return `${days} hari lagi`;
};

// Tile kecil untuk status server: satu angka, satu keterangan. Sengaja lebih
// rapat daripada kartu ringkasan — ini informasi sekunder di dasar halaman.
const Metric: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <div className="rounded-md border border-slate-700/50 bg-slate-900/30 px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-xs font-semibold text-slate-200">{value}</div>
    {note && <div className="text-[10px] text-slate-500">{note}</div>}
  </div>
);

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const response = await api.get<DashboardData>('/api/dashboard');
      setData(response.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 30000 });

  const server = data?.server;
  const online = data?.online;

  // Persentase penolakan yang berarti: hanya akun sungguhan, bukan percobaan
  // MAC dari halaman login hotspot.
  const percentAkun =
    data && data.auth.total > 0
      ? Math.round((data.auth.reject_account / data.auth.total) * 100)
      : 0;

  return (
    <div className="page-container">
      {loading && <Loading label="Memuat dashboard…" />}
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      {data && server && online && !loading && (
        <>
          {/* Dua angka yang paling dibutuhkan operator: jumlah pelanggan dan
              nilai tagihan yang belum masuk. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <p className="text-xs text-slate-400">Pelanggan</p>
              <p className="mt-1 text-3xl font-semibold text-slate-100">
                {data.total_customers.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500">{data.total_invoices} tagihan</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Tagihan belum bayar</p>
              <p className="mt-1 text-3xl font-semibold text-amber-300">
                {rupiah(data.unpaid_total)}
              </p>
              <p className="text-[11px] text-slate-500">{data.unpaid_count} tagihan</p>
            </Card>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-slate-400">Pendapatan hari ini</p>
              <p className="mt-1 text-lg font-semibold text-emerald-300">
                {rupiah(data.today_revenue)}
              </p>
              <p className="text-[11px] text-slate-500">{data.today_payments} pembayaran</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Online hotspot</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">
                {online.hotspot === null ? '—' : online.hotspot.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500">sumber: {online.device ?? 'RADIUS'}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-400">Online PPP</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">
                {online.ppp === null ? '—' : online.ppp.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500">sumber: {online.device ?? 'RADIUS'}</p>
            </Card>
          </div>

          {online.error && (
            <p className="mt-3 text-xs text-amber-300">
              Sesi online tidak terbaca: {online.error}
            </p>
          )}

          {online.unclassified > 0 && (
            <p className="mt-2 text-[11px] text-amber-300">
              {online.unclassified} sesi terbuka tidak dikenali sebagai hotspot atau PPP —
              akunnya tidak ada di data RADIUS, jadi tidak dihitung di dua kartu di atas.
            </p>
          )}

          {/* Tiga blok kerja operator: kesehatan autentikasi, akun yang akan
              habis, dan stok voucher. Semuanya dari database RADIUS — tidak ada
              panggilan API perangkat dari dashboard. */}
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {/* 1. Autentikasi RADIUS 24 jam */}
            <Card>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-slate-400">Autentikasi 24 jam</p>
                  <p className="text-[11px] text-slate-500">dari radpostauth</p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    percentAkun >= 50
                      ? 'bg-rose-500/15 text-rose-300'
                      : percentAkun >= 20
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {percentAkun}% akun ditolak
                </span>
              </div>

              {data.auth.error ? (
                <p className="text-xs text-amber-300">{data.auth.error}</p>
              ) : data.auth.total === 0 ? (
                <p className="text-xs text-slate-500">Belum ada percobaan login tercatat.</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-4">
                    <div>
                      <p className="text-lg font-semibold text-emerald-300">
                        {data.auth.accept.toLocaleString('id-ID')}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">diterima</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-rose-300">
                        {data.auth.reject_account.toLocaleString('id-ID')}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        akun ditolak
                      </p>
                    </div>
                  </div>
                  {data.auth.top_rejected.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        akun paling sering ditolak
                      </p>
                      {data.auth.top_rejected.map((item) => (
                        <p key={item.username} className="font-mono text-[11px] text-slate-300">
                          {item.username}
                          <span className="ml-1 text-slate-500">×{item.count}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {data.auth.reject_mac > 0 && (
                    <p className="mt-2 text-[10px] text-slate-500">
                      +{data.auth.reject_mac} percobaan MAC dari halaman login hotspot — normal,
                      tidak dihitung sebagai akun ditolak.
                    </p>
                  )}
                </>
              )}
            </Card>

            {/* 2. Akun habis / hampir habis */}
            <Card>
              <div className="mb-2">
                <p className="text-xs text-slate-400">Masa aktif habis</p>
                <p className="text-[11px] text-slate-500">dalam 3 hari ke depan</p>
              </div>

              {data.expiring.error ? (
                <p className="text-xs text-amber-300">{data.expiring.error}</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-4">
                    <div>
                      <p className="text-lg font-semibold text-rose-300">
                        {data.expiring.overdue}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">lewat</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-amber-300">
                        {data.expiring.in_24h + data.expiring.in_3d}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">akan habis</p>
                    </div>
                  </div>

                  {data.expiring.rows.length > 0 ? (
                    <div className="mt-2 space-y-0.5">
                      {data.expiring.rows.slice(0, 5).map((row) => (
                        <div
                          key={row.username}
                          className="flex items-baseline justify-between gap-2"
                          title={`${row.profile_name} · berakhir ${tanggal(row.expires_at)}`}
                        >
                          <span className="truncate font-mono text-[11px] text-slate-300">
                            {row.username}
                          </span>
                          <span
                            className={`shrink-0 text-[10px] ${
                              row.days_left < 0 ? 'text-rose-300' : 'text-slate-500'
                            }`}
                          >
                            {sisaWaktu(row.days_left)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Tidak ada akun yang habis dalam 3 hari ke depan.
                    </p>
                  )}

                  {data.expiring.without_expiry > 0 && (
                    <p className="mt-2 text-[10px] text-slate-500">
                      {data.expiring.without_expiry} akun aktif tanpa masa aktif (profil tanpa batas
                      waktu) — tidak dihitung.
                    </p>
                  )}
                </>
              )}
            </Card>

            {/* 3. Stok voucher per profil */}
            <Card>
              <div className="mb-2">
                <p className="text-xs text-slate-400">Voucher per profil</p>
                <p className="text-[11px] text-slate-500">siap pakai vs terpakai</p>
              </div>

              {data.vouchers.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada voucher dibuat.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.vouchers.map((row) => (
                    <div key={`${row.profile_type}-${row.profile_name}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[11px] text-slate-300">
                          {row.profile_name}
                          <span className="ml-1 text-[10px] text-slate-500">{row.profile_type}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          {row.total}
                        </span>
                      </div>
                      <div className="mt-0.5 flex h-1.5 overflow-hidden rounded bg-slate-700/50">
                        {row.ready > 0 && (
                          <span
                            className="bg-emerald-400"
                            style={{ width: `${(row.ready / row.total) * 100}%` }}
                            title={`siap pakai: ${row.ready}`}
                          />
                        )}
                        {row.used > 0 && (
                          <span
                            className="bg-cyan-400"
                            style={{ width: `${(row.used / row.total) * 100}%` }}
                            title={`terpakai: ${row.used}`}
                          />
                        )}
                        {row.created > 0 && (
                          <span
                            className="bg-slate-400"
                            style={{ width: `${(row.created / row.total) * 100}%` }}
                            title={`baru dibuat: ${row.created}`}
                          />
                        )}
                        {row.expired > 0 && (
                          <span
                            className="bg-rose-400/70"
                            style={{ width: `${(row.expired / row.total) * 100}%` }}
                            title={`kedaluwarsa: ${row.expired}`}
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        siap {row.ready} · terpakai {row.used} · baru {row.created}
                        {row.expired > 0 ? ` · kedaluwarsa ${row.expired}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Status server: informasi sekunder, diletakkan paling bawah. */}
          <Card className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Status server</p>
              <p className="text-[11px] text-slate-500">{server.cpu_count} core</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              <Metric label="Uptime" value={formatUptime(server.uptime_seconds)} />
              <Metric
                label="RAM"
                value={`${percent(server.mem_used, server.mem_total)}%`}
                note={`${formatBytes(server.mem_used)} / ${formatBytes(server.mem_total)}`}
              />
              <Metric
                label="Disk"
                value={`${percent(server.disk_used, server.disk_total)}%`}
                note={`${formatBytes(server.disk_used)} / ${formatBytes(server.disk_total)}`}
              />
              <Metric
                label="CPU"
                value={server.cpu_percent === null ? '—' : `${server.cpu_percent}%`}
              />
              <Metric label="Proses" value={server.processes.toLocaleString('id-ID')} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default Dashboard;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import {
  Badge,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  Table,
  errorMessage,
  formatBytes,
  formatUptime,
} from '../components/net/NetUI';

// Dasbor admin ISP: pertanyaan pertama saat membuka panel adalah "uang hari ini
// berapa, siapa yang belum bayar, pelanggan aktif berapa, dan jaringan hidup
// atau tidak". Semua blok di bawah menjawab salah satu dari itu — log
// autentikasi, masa aktif akun, dan stok voucher sengaja tidak ditampilkan di
// sini karena itu pekerjaan teknis, bukan pandangan pemilik layanan.
//
// Tata letak: satu kolom di ponsel; tabel berubah menjadi daftar kartu di bawah
// breakpoint sm supaya nama pelanggan dan nominal tidak terpotong.

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
  hotspot_voucher: number | null;
  hotspot_member: number | null;
  unclassified: number;
  device: string | null;
  error: string | null;
}

interface RevenueSnapshot {
  today_revenue: number;
  today_payments: number;
  today_vouchers: number;
  today_margin: number;
  month_revenue: number;
  scope: 'all' | 'own';
}

interface CustomerBreakdown {
  total: number;
  active: number;
  expired: number;
  suspend: number;
  disable: number;
}

interface OverdueInvoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  due_date: string;
  days_late: number;
}

interface ReceivableSnapshot {
  total: number;
  not_due_total: number;
  open_invoices: number;
  overdue_count: number;
  overdue_total: number;
  due_soon_count: number;
  due_soon_total: number;
  oldest: OverdueInvoice[];
}

interface RecentPayment {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  method: string;
  paid_at: string;
  recorded_by_name: string | null;
}

interface RecentInvoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  status: string;
  due_date: string;
}

interface OnuHealth {
  total: number;
  missing: number;
  error: string | null;
}

interface DashboardData {
  total_customers: number;
  active_packages: number;
  total_invoices: number;
  unpaid_count: number;
  unpaid_total: number;
  today_revenue: number;
  today_payments: number;
  revenue: RevenueSnapshot;
  customers: CustomerBreakdown;
  receivable: ReceivableSnapshot;
  recent_payments: RecentPayment[];
  recent_invoices: RecentInvoice[];
  onu: OnuHealth;
  server: ServerMetrics;
  online: OnlineCounts;
}

const rupiah = (value: number): string =>
  `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

const angka = (value: number): string => value.toLocaleString('id-ID');

const persen = (used: number, total: number): number =>
  total > 0 ? Math.round((used / total) * 100) : 0;

const tanggal = (iso: string): string => {
  if (!iso) return '-';
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

const jam = (iso: string): string => {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const METODE: Record<string, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  other: 'Lainnya',
};

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'mute' }> = {
  paid: { label: 'Lunas', tone: 'good' },
  unpaid: { label: 'Belum bayar', tone: 'warn' },
  overdue: { label: 'Terlambat', tone: 'bad' },
  partial: { label: 'Sebagian', tone: 'mute' },
};

const sesi = (value: number | null): string => (value === null ? '—' : angka(value));

// Satu angka besar + keterangan kecil. Dipakai untuk pertanyaan utama.
const Kpi: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ label, value, tone = 'text-slate-100', badge, children }) => (
  <Card>
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs text-slate-400">{label}</p>
      {badge}
    </div>
    <p className={`mt-1 text-2xl font-semibold leading-tight sm:text-3xl ${tone}`}>{value}</p>
    {children && <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">{children}</div>}
  </Card>
);

const Bar: React.FC<{ label: string; value: number; note: string; tone: string }> = ({
  label,
  value,
  note,
  tone,
}) => (
  <div>
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-300">{note}</span>
    </div>
    <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-700/60">
      <span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  </div>
);

// Nomor tagihan selalu bisa diklik ke detail tagihan (halaman Tagihan yang ada).
const InvoiceLink: React.FC<{ id: number; number: string }> = ({ id, number }) => (
  <Link
    to={`/invoices?invoice=${id}`}
    className="font-mono text-xs text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline"
  >
    {number}
  </Link>
);

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan di
  // belakang layar tanpa mengosongkan data yang sudah tampil.
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

  useBackgroundRefresh(load, { intervalMs: 60000 });

  const server = data?.server;
  const online = data?.online;

  const hariIni = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="page-container">
      <PageHeader
        title="Dasbor"
        subtitle={`Uang, tagihan, dan jaringan pada satu layar · ${hariIni}`}
      />

      {loading && <Loading label="Memuat dasbor…" />}
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      {data && server && online && !loading && (
        <div className="space-y-3">
          {/* Uang dan pelanggan */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Kpi
              label="Pendapatan hari ini"
              value={rupiah(data.revenue.today_revenue)}
              tone="text-emerald-300"
              badge={
                <Badge tone="mute">
                  {data.revenue.scope === 'all' ? 'semua pemilik' : 'milik Anda'}
                </Badge>
              }
            >
              <p>
                Tagihan {rupiah(data.revenue.today_payments)} · Voucher{' '}
                {rupiah(data.revenue.today_vouchers)}
              </p>
              {data.revenue.today_vouchers > 0 && (
                <p className="text-slate-500">Laba voucher {rupiah(data.revenue.today_margin)}</p>
              )}
              <p className="pt-1 text-slate-300">Bulan ini {rupiah(data.revenue.month_revenue)}</p>
            </Kpi>

            <Kpi
              label="Total piutang"
              value={rupiah(data.receivable.total ?? data.unpaid_total)}
              tone="text-amber-300"
            >
              <p>
                {angka(data.receivable.open_invoices ?? data.unpaid_count)} tagihan terbuka dari{' '}
                {angka(data.total_invoices)} total tagihan
              </p>
              <p className={data.receivable.overdue_count > 0 ? 'text-rose-300' : 'text-slate-500'}>
                Sudah jatuh tempo {angka(data.receivable.overdue_count)} ·{' '}
                {rupiah(data.receivable.overdue_total)}
              </p>
              <p className="text-slate-500">
                Belum jatuh tempo · {rupiah(data.receivable.not_due_total ?? 0)}
              </p>
              <p className="text-slate-500">
                Jatuh tempo ≤7 hari {angka(data.receivable.due_soon_count)} ·{' '}
                {rupiah(data.receivable.due_soon_total)}
              </p>
            </Kpi>

            <p className="md:col-span-2 rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
              Tiga angka ini berbeda dan tidak saling mengurangi: <span className="text-slate-200">tagihan
              diterbitkan</span> dihitung dari tanggal invoice, <span className="text-slate-200">kas masuk</span> dari
              tanggal pembayaran, dan <span className="text-slate-200">saldo piutang</span> dari sisa tagihan yang belum
              lunas (unpaid/partial).
            </p>

            <Link
              to="/customers?state=active"
              className="group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Buka daftar pelanggan aktif"
            >
              <Card className="h-full transition group-hover:border-cyan-500/50 group-hover:bg-slate-800/80">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate-400">Pelanggan aktif</p>
                  <Badge tone="mute">{angka(data.customers.total)} terdaftar</Badge>
                </div>
                <p className="mt-1 text-2xl font-semibold leading-tight text-slate-100 sm:text-3xl">
                  {angka(data.customers.active)}
                </p>
                <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                  <p>
                    Paket aktif {angka(data.active_packages)} · suspend{' '}
                    {angka(data.customers.suspend)}
                  </p>
                  <p className={data.customers.expired > 0 ? 'text-amber-300' : 'text-slate-500'}>
                    Masa layanan habis {angka(data.customers.expired)} · nonaktif{' '}
                    {angka(data.customers.disable)}
                  </p>
                  <p className="pt-1 text-cyan-300/80 group-hover:text-cyan-200">
                    Lihat daftar pelanggan aktif →
                  </p>
                </div>
              </Card>
            </Link>
          </div>

          {/* Koneksi dipisah: PPPoE dan Hotspot masing-masing bisa diklik */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Link
              to="/sesi?jenis=ppp"
              className="group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Buka sesi PPPoE yang aktif"
            >
              <Card className="h-full transition group-hover:border-cyan-500/50 group-hover:bg-slate-800/80">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate-400">Online PPPoE</p>
                  <Badge tone="mute">RADIUS</Badge>
                </div>
                <p className="mt-1 text-2xl font-semibold leading-tight text-slate-100 sm:text-3xl">
                  {sesi(online.ppp)}
                </p>
                <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                  <p>Pelanggan PPPoE yang sedang tersambung</p>
                  <p className="pt-1 text-cyan-300/80 group-hover:text-cyan-200">
                    Lihat sesi PPPoE →
                  </p>
                </div>
              </Card>
            </Link>

            <Link
              to="/sesi?jenis=hotspot&user_type=voucher"
              className="group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Buka sesi hotspot voucher"
            >
              <Card className="h-full transition group-hover:border-cyan-500/50 group-hover:bg-slate-800/80">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate-400">Online Hotspot</p>
                  <Badge tone="mute">RADIUS</Badge>
                </div>
                <p className="mt-1 text-2xl font-semibold leading-tight text-slate-100 sm:text-3xl">
                  {sesi(online.hotspot)}
                </p>
                <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                  <p>
                    Voucher {sesi(online.hotspot_voucher)} · Member{' '}
                    {sesi(online.hotspot_member)}
                  </p>
                  <p className="pt-1 text-cyan-300/80 group-hover:text-cyan-200">
                    Lihat voucher (default) atau member →
                  </p>
                </div>
              </Card>
            </Link>

            <Card className="sm:col-span-2 xl:col-span-1">
              <div className="mb-2">
                <p className="text-xs text-slate-400">Kondisi jaringan</p>
                <p className="text-[11px] text-slate-500">Inventori OLT dan beban server</p>
              </div>

              {data.onu.error ? (
                <p className="text-[11px] text-amber-300">
                  Data ONU belum tersedia: {data.onu.error}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  ONU terpasang{' '}
                  <span className="text-slate-200">
                    {angka(data.onu.total - data.onu.missing)} / {angka(data.onu.total)}
                  </span>
                  {data.onu.missing > 0 && (
                    <span className="text-amber-300">
                      {' '}
                      · {angka(data.onu.missing)} tidak terlihat
                    </span>
                  )}
                </p>
              )}

              <div className="mt-3 space-y-2">
                <Bar
                  label="CPU"
                  value={server.cpu_percent ?? 0}
                  note={server.cpu_percent === null ? '—' : `${server.cpu_percent}%`}
                  tone="bg-cyan-400"
                />
                <Bar
                  label="RAM"
                  value={persen(server.mem_used, server.mem_total)}
                  note={`${formatBytes(server.mem_used)} / ${formatBytes(server.mem_total)}`}
                  tone="bg-emerald-400"
                />
                <Bar
                  label="Disk"
                  value={persen(server.disk_used, server.disk_total)}
                  note={`${formatBytes(server.disk_used)} / ${formatBytes(server.disk_total)}`}
                  tone="bg-amber-400"
                />
              </div>

              <p className="mt-3 text-[11px] text-slate-500">
                Uptime {formatUptime(server.uptime_seconds)} · {server.cpu_count} core ·{' '}
                {angka(server.processes)} proses
              </p>
            </Card>
          </div>

          {online.error && (
            <p className="text-xs text-amber-300">Sesi online tidak terbaca: {online.error}</p>
          )}
          {online.unclassified > 0 && (
            <p className="text-[11px] text-amber-300">
              {angka(online.unclassified)} sesi terbuka tidak dikenali sebagai PPP atau hotspot —
              akunnya tidak ada di data RADIUS.
            </p>
          )}

          {/* Tagihan terlambat + pembayaran terbaru */}
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">Tagihan terlambat</p>
                  <p className="text-[11px] text-slate-500">
                    Belum lunas dan sudah lewat jatuh tempo — paling lama di atas
                  </p>
                </div>
                <Badge tone={data.receivable.overdue_count > 0 ? 'bad' : 'good'}>
                  {angka(data.receivable.overdue_count)} tagihan
                </Badge>
              </div>

              {data.receivable.oldest.length === 0 ? (
                <p className="text-xs text-slate-500">Tidak ada tagihan yang terlambat.</p>
              ) : (
                <>
                  {/* Ponsel: daftar kartu, bukan tabel yang terpotong */}
                  <ul className="divide-y divide-slate-700/50 sm:hidden">
                    {data.receivable.oldest.map((invoice) => (
                      <li key={invoice.id} className="py-2 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <InvoiceLink id={invoice.id} number={invoice.invoice_number} />
                            <p className="truncate text-sm text-slate-200">
                              {invoice.customer_name}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm text-slate-100">{rupiah(invoice.amount)}</p>
                            <p className="text-[11px] text-rose-300">
                              {angka(invoice.days_late)} hari
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="hidden sm:block">
                    <Table columns={['Nomor', 'Pelanggan', 'Sisa tagihan', 'Terlambat']} isEmpty={false}>
                      {data.receivable.oldest.map((invoice) => (
                        <tr key={invoice.id}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <InvoiceLink id={invoice.id} number={invoice.invoice_number} />
                          </td>
                          <td className="px-3 py-2 truncate max-w-[16rem]">
                            {invoice.customer_name}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {rupiah(invoice.amount)}
                          </td>
                          <td className="px-3 py-2 text-rose-300 whitespace-nowrap">
                            {angka(invoice.days_late)} hari
                            <span className="ml-1 text-[10px] text-slate-500">
                              ({tanggal(invoice.due_date)})
                            </span>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                </>
              )}
            </Card>

            <Card>
              <div className="mb-2">
                <p className="text-sm font-medium text-slate-200">Pembayaran terbaru</p>
                <p className="text-[11px] text-slate-500">Uang masuk yang tercatat sistem</p>
              </div>
              {data.recent_payments.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada pembayaran tercatat.</p>
              ) : (
                <ul className="divide-y divide-slate-700/50">
                  {data.recent_payments.map((payment) => (
                    <li key={payment.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-sm text-slate-200">
                          {payment.customer_name}
                        </span>
                        <span className="shrink-0 text-sm font-medium text-emerald-300">
                          {rupiah(payment.amount)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {jam(payment.paid_at)} · {METODE[payment.method] ?? payment.method}
                        {payment.recorded_by_name ? ` · oleh ${payment.recorded_by_name}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Tagihan terbaru */}
          <Card>
            <div className="mb-2">
              <p className="text-sm font-medium text-slate-200">Tagihan terbaru</p>
              <p className="text-[11px] text-slate-500">
                Lima tagihan terakhir yang terbit (tagihan batal tidak dihitung)
              </p>
            </div>

            {data.recent_invoices.length === 0 ? (
              <p className="text-xs text-slate-500">Belum ada tagihan terbit.</p>
            ) : (
              <>
                <ul className="divide-y divide-slate-700/50 sm:hidden">
                  {data.recent_invoices.map((invoice) => {
                    const status = STATUS[invoice.status] ?? {
                      label: invoice.status,
                      tone: 'mute' as const,
                    };
                    return (
                      <li key={invoice.id} className="py-2 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <InvoiceLink id={invoice.id} number={invoice.invoice_number} />
                            <p className="truncate text-sm text-slate-200">
                              {invoice.customer_name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Jatuh tempo {tanggal(invoice.due_date)}
                            </p>
                          </div>
                          <div className="shrink-0 space-y-1 text-right">
                            <p className="text-sm text-slate-100">{rupiah(invoice.amount)}</p>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="hidden sm:block">
                  <Table
                    columns={['Nomor', 'Pelanggan', 'Nominal', 'Status', 'Jatuh tempo']}
                    isEmpty={false}
                  >
                    {data.recent_invoices.map((invoice) => {
                      const status = STATUS[invoice.status] ?? {
                        label: invoice.status,
                        tone: 'mute' as const,
                      };
                      return (
                        <tr key={invoice.id}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <InvoiceLink id={invoice.id} number={invoice.invoice_number} />
                          </td>
                          <td className="px-3 py-2 truncate max-w-[14rem]">
                            {invoice.customer_name}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {rupiah(invoice.amount)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                            {tanggal(invoice.due_date)}
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import {
  Badge,
  Card,
  ErrorNote,
  Loading,
  formatBytes,
  formatUptime,
} from '../components/net/NetUI';
import {
  Icon,
  IconBubble,
  Section,
  Skeleton,
  SkeletonKpi,
  type IconName,
} from '../components/dashboard/icons';

// Dasbor admin ISP: "uang hari ini berapa, siapa yang belum bayar, pelanggan
// aktif berapa, dan jaringan hidup atau tidak". Semua angka berasal dari satu
// endpoint baca-saja GET /api/dashboard — tidak ada angka yang dikarang, dan
// hal teknis (log auth RADIUS, stok voucher per profil) sengaja ditinggalkan.

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
  hotspot_customer: number | null;
  unclassified: number;
  device: string | null;
  error: string | null;
  source: 'radius' | 'device' | null;
}

interface RevenueSnapshot {
  today: string;
  month_start: string;
  today_revenue: number;
  today_payments: number;
  today_vouchers: number;
  today_margin: number;
  month_revenue: number;
  month_payments: number;
  month_vouchers: number;
  month_margin: number;
  daily: Array<{ day: string; payments: number; vouchers: number }>;
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

// ---- util format -----------------------------------------------------------

const rupiah = (value: number): string =>
  `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

// Nilai sumbu grafik: jutaan/ribuan supaya tidak memenuhi sumbu dengan angka
// panjang saat menampilkan pendapatan harian.
const rupiahSingkat = (value: number): string => {
  if (!value) return '0';
  if (value >= 1_000_000) {
    const jt = value / 1_000_000;
    return `${Number.isInteger(jt) ? jt : jt.toFixed(1)} jt`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)} rb`;
  return String(Math.round(value));
};

const angka = (value: number): string => value.toLocaleString('id-ID');

const persen = (used: number, total: number): number =>
  total > 0 ? Math.round((used / total) * 100) : 0;

const sesi = (value: number | null): string => (value === null ? '—' : angka(value));

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

// ---- bagian ----------------------------------------------------------------

// Satu kartu KPI utama: ikon + label + angka besar + keterangan, bisa diklik.
const KpiCard: React.FC<{
  to: string;
  label: string;
  value: React.ReactNode;
  icon: IconName;
  tone: string;
  iconTone: string;
  children?: React.ReactNode;
  badge?: React.ReactNode;
}> = ({ to, label, value, icon, tone, iconTone, children, badge }) => (
  <Link
    to={to}
    className="group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
  >
    <Card className="flex h-full flex-col transition group-hover:border-cyan-500/50 group-hover:bg-slate-800/80">
      <div className="flex items-start justify-between gap-2">
        <IconBubble name={icon} tone={iconTone} />
        {badge}
      </div>
      <p className="mt-3 text-xs text-slate-400">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold leading-tight sm:text-3xl ${tone}`}>
        {value}
      </p>
      {children && (
        <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">{children}</div>
      )}
    </Card>
  </Link>
);

// Indikator kecil "hidup/aktif" bernada hijau.
const LiveDot: React.FC<{ tone: 'good' | 'warn' | 'bad' | 'mute' }> = ({ tone }) => {
  const map = {
    good: 'bg-emerald-400',
    warn: 'bg-amber-400',
    bad: 'bg-rose-400',
    mute: 'bg-slate-500',
  } as const;
  return <span className={`inline-block h-2 w-2 rounded-full ${map[tone]}`} />;
};

// Browser breadcrumb + judul + dering notifikasi (jumlah tagihan terlambat).
const DashboardHeader: React.FC<{
  overdueCount: number;
  updatedAt: string | null;
}> = ({ overdueCount, updatedAt }) => {
  const hariIni = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Link to="/dashboard" className="hover:text-slate-300">
            Dasbor
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-slate-400">Overview</span>
        </nav>
        <h1 className="text-xl font-semibold text-white">Selamat datang kembali 👋</h1>
        <p className="mt-1 text-sm text-slate-400">
          Ringkasan bisnis ISP Anda · <span className="text-slate-300">{hariIni}</span>
          {updatedAt && <span className="text-slate-500"> · diperbarui {updatedAt}</span>}
        </p>
      </div>
      <Link
        to="/invoices"
        className="relative rounded-lg border border-slate-700/60 bg-slate-800/60 p-2 text-slate-300 transition hover:border-slate-600 hover:text-white"
        aria-label={`${overdueCount} tagihan terlambat`}
        title="Tagihan terlambat"
      >
        <Icon name="bell" className="h-5 w-5" />
        {overdueCount > 0 && (
          <span className="num absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {overdueCount}
          </span>
        )}
      </Link>
    </div>
  );
};

// Grafik pendapatan harian: kas masuk (tagihan) + penjualan voucher per hari,
// selama bulan berjalan (hari 1..hari ini).
const RevenueChart: React.FC<{ revenue: RevenueSnapshot }> = ({ revenue }) => {
  const rows = (revenue.daily ?? []).map((d) => ({
    hari: d.day,
    Tagihan: d.payments,
    Voucher: d.vouchers,
  }));
  return (
    <Section title="Analitik keuangan" subtitle="Kas masuk harian (tagihan + voucher, rupiah) bulan berjalan">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="hari"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              tickFormatter={(v: string) => v.slice(8, 10)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => rupiahSingkat(v)}
            />
            <Tooltip
              cursor={{ fill: '#33415555' }}
              formatter={(value) => [rupiah(Number(value))]}
              labelFormatter={(label) => `Tanggal ${label}`}
              contentStyle={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#94a3b8' }}
              iconType="circle"
              iconSize={8}
            />
            <Bar dataKey="Tagihan" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Voucher" stackId="a" fill="#22d3ee" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-700/50 pt-3 text-center">
        <div>
          <p className="text-[11px] text-slate-500">Pendapatan hari ini</p>
          <p className="num mt-0.5 text-sm font-semibold text-emerald-300">
            {rupiah(revenue.today_revenue)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Bulan ini</p>
          <p className="num mt-0.5 text-sm font-semibold text-slate-100">
            {rupiah(revenue.month_revenue)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Laba voucher</p>
          <p className="num mt-0.5 text-sm font-semibold text-cyan-300">
            {rupiah(revenue.month_margin)}
          </p>
        </div>
      </div>
    </Section>
  );
};

// Ringkasan status tagihan: lunas, belum bayar, terlambat, dan jatuh tempo.
const BillingOverview: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { receivable, total_invoices, unpaid_count } = data;
  const paid = Math.max(0, total_invoices - unpaid_count);
  const items = [
    {
      label: 'Lunas',
      value: angka(paid),
      tone: 'text-emerald-300',
      icon: 'check-circle' as IconName,
    },
    {
      label: 'Belum bayar',
      value: angka(unpaid_count),
      tone: 'text-amber-300',
      icon: 'clock' as IconName,
    },
    {
      label: 'Terlambat',
      value: angka(receivable.overdue_count),
      tone: receivable.overdue_count > 0 ? 'text-rose-300' : 'text-slate-300',
      icon: 'triangle' as IconName,
    },
    {
      label: 'Jatuh tempo ≤7 hari',
      value: angka(receivable.due_soon_count),
      tone: 'text-slate-300',
      icon: 'receipt' as IconName,
    },
  ];
  return (
    <Section
      title="Ringkasan tagihan"
      subtitle={`Piutang ${rupiah(receivable.total)}`}
      action={
        <Link to="/invoices" className="text-[11px] text-cyan-300 hover:text-cyan-200">
          Lihat semua →
        </Link>
      }
    >
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </span>
            <span className={`num text-sm font-semibold ${item.tone}`}>{item.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-1 border-t border-slate-700/50 pt-3 text-[11px] text-slate-500">
        <p className="flex justify-between">
          <span>Terlambat</span>
          <span className="num text-rose-300">{rupiah(receivable.overdue_total)}</span>
        </p>
        <p className="flex justify-between">
          <span>Jatuh tempo ≤7 hari</span>
          <span className="num text-slate-300">{rupiah(receivable.due_soon_total)}</span>
        </p>
      </div>
    </Section>
  );
};

// Tinjauan jaringan: sesi online, inventori ONU, dan beban server.
const NetworkStatus: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { online, onu, server, customers } = data;
  const onlineTone = (v: number | null): 'good' | 'mute' => (v !== null && v > 0 ? 'good' : 'mute');
  return (
    <Section
      title="Pemantauan jaringan"
      subtitle="Sesi RADIUS yang hidup, inventori OLT, dan beban server"
      action={
        <span className="text-[11px] text-slate-500">sumber: {online.device ?? 'RADIUS'}</span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link
          to="/sesi?jenis=ppp"
          className="group rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 transition hover:border-cyan-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Icon name="arrow-path" className="h-4 w-4" /> PPPoE
            </span>
            <LiveDot tone={onlineTone(online.ppp)} />
          </div>
          <p className="num mt-2 text-2xl font-semibold text-slate-100">{sesi(online.ppp)}</p>
          <p className="text-[11px] text-slate-500">sesi tersambung · lihat detail →</p>
        </Link>

        <Link
          to="/sesi?jenis=hotspot&user_type=voucher"
          className="group rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 transition hover:border-cyan-500/50"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Icon name="wifi" className="h-4 w-4" /> Hotspot
            </span>
            <LiveDot tone={onlineTone(online.hotspot)} />
          </div>
          <p className="num mt-2 text-2xl font-semibold text-slate-100">{sesi(online.hotspot)}</p>
          <p className="text-[11px] text-slate-500">
            voucher {sesi(online.hotspot_voucher)} · customer {sesi(online.hotspot_customer)}
          </p>
        </Link>

        <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Icon name="activity" className="h-4 w-4" /> ONU
            </span>
            <LiveDot tone={onu.missing === 0 ? 'good' : 'warn'} />
          </div>
          <p className="num mt-2 text-2xl font-semibold text-slate-100">
            {angka(Math.max(0, onu.total - onu.missing))}
            <span className="text-base text-slate-500">/{angka(onu.total)}</span>
          </p>
          <p className="text-[11px] text-slate-500">
            {onu.missing > 0 ? `${angka(onu.missing)} tidak terlihat` : 'semua terlihat'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Icon name="cpu-chip" className="h-4 w-4" /> Server
            </span>
            <LiveDot tone="good" />
          </div>
          <div className="mt-2 space-y-1.5">
            <InlineBar label="CPU" pct={server.cpu_percent ?? 0} note={server.cpu_percent === null ? '—' : `${server.cpu_percent}%`} tone="bg-cyan-400" />
            <InlineBar label="RAM" pct={persen(server.mem_used, server.mem_total)} note={`${formatBytes(server.mem_used)}`} tone="bg-emerald-400" />
            <InlineBar label="Disk" pct={persen(server.disk_used, server.disk_total)} note={`${formatBytes(server.disk_used)}`} tone="bg-amber-400" />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">uptime {formatUptime(server.uptime_seconds)}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Pelanggan aktif {angka(customers.active)} dari {angka(customers.total)} terdaftar. Status
        NAS &amp; FreeRADIUS: cek di menu Layanan → FreeRADIUS dan Jaringan.
      </p>
    </Section>
  );
};

// Bilah mini (progress) untuk CPU/RAM/Disk.
const InlineBar: React.FC<{ label: string; pct: number; note: string; tone: string }> = ({
  label,
  pct,
  note,
  tone,
}) => (
  <div>
    <div className="flex items-baseline justify-between text-[10px]">
      <span className="text-slate-500">{label}</span>
      <span className="num text-slate-400">{note}</span>
    </div>
    <div className="mt-0.5 h-1 overflow-hidden rounded bg-slate-700/60">
      <span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  </div>
);

// Tinjauan bisnis: pelanggan, paket aktif, dan pintasan pengelolaan.
const BusinessOverview: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { customers, active_packages } = data;
  const stats = [
    { label: 'Total pelanggan', value: angka(customers.total), tone: 'text-slate-100', to: '/customers' },
    { label: 'Aktif', value: angka(customers.active), tone: 'text-emerald-300', to: '/customers?state=active' },
    { label: 'Suspend', value: angka(customers.suspend), tone: 'text-amber-300', to: '/customers?state=suspend' },
    { label: 'Habis masa', value: angka(customers.expired), tone: 'text-rose-300', to: '/customers?state=expired' },
    { label: 'Nonaktif', value: angka(customers.disable), tone: 'text-slate-400', to: '/customers?state=disable' },
    { label: 'Paket aktif', value: angka(active_packages), tone: 'text-cyan-300', to: '/layanan/hotspot' },
  ];
  return (
    <Section title="Tinjauan bisnis" subtitle="Pelanggan dan layanan aktif">
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 transition hover:border-cyan-500/50"
          >
            <p className="text-[11px] text-slate-500">{s.label}</p>
            <p className={`num mt-1 text-xl font-semibold ${s.tone}`}>{s.value}</p>
          </Link>
        ))}
      </div>
    </Section>
  );
};

// Aktivitas terbaru: gabungan pembayaran masuk + tagihan terbit, terurut waktu.
const RecentActivities: React.FC<{ data: DashboardData }> = ({ data }) => {
  type Activity = {
    key: string;
    kind: 'bayar' | 'tagihan';
    title: string;
    sub: string;
    amount?: number;
    time: string;
    link: string;
    tone: 'good' | 'mute' | 'bad' | 'warn';
  };
  const activities: Activity[] = [
    ...data.recent_payments.map((p): Activity => ({
      key: `pay-${p.id}`,
      kind: 'bayar',
      title: p.customer_name,
      sub: `${METODE[p.method] ?? p.method}${p.recorded_by_name ? ` · oleh ${p.recorded_by_name}` : ''}`,
      amount: p.amount,
      time: p.paid_at,
      link: `/invoices?invoice=${p.id}`,
      tone: 'good',
    })),
    ...data.recent_invoices.map((i): Activity => ({
      key: `inv-${i.id}`,
      kind: 'tagihan',
      title: i.invoice_number,
      sub: i.customer_name,
      amount: i.amount,
      time: i.due_date,
      link: `/invoices?invoice=${i.id}`,
      tone: STATUS[i.status]?.tone ?? 'mute',
    })),
  ]
    .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
    .slice(0, 8);

  if (activities.length === 0) {
    return (
      <Section title="Aktivitas terbaru" subtitle="Pembayaran dan tagihan terakhir">
        <p className="text-xs text-slate-500">Belum ada aktivitas tercatat.</p>
      </Section>
    );
  }
  return (
    <Section title="Aktivitas terbaru" subtitle="Pembayaran dan tagihan terakhir">
      <ul className="divide-y divide-slate-700/50">
        {activities.map((a) => (
          <li key={a.key} className="py-2 first:pt-0 last:pb-0">
            <Link to={a.link} className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <IconBubble
                  name={a.kind === 'bayar' ? 'banknotes' : 'receipt'}
                  tone={
                    a.kind === 'bayar'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-cyan-500/10 text-cyan-400'
                  }
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{a.title}</p>
                  <p className="truncate text-[11px] text-slate-500">{a.sub}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                {a.amount !== undefined && (
                  <p className={`num text-sm font-medium ${a.tone === 'good' ? 'text-emerald-300' : 'text-slate-300'}`}>
                    {rupiah(a.amount)}
                  </p>
                )}
                <p className="text-[11px] text-slate-500">
                  {a.kind === 'bayar' ? jam(a.time) : tanggal(a.time)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
};

// Peringatan sistem: tagihan terlambat + gangguan jaringan + catatan sesi.
const SystemAlerts: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { receivable, onu, online } = data;
  const alerts: {
    tone: 'bad' | 'warn' | 'info';
    icon: IconName;
    text: string;
    to?: string;
  }[] = [];

  if (receivable.overdue_count > 0) {
    alerts.push({
      tone: 'bad',
      icon: 'triangle',
      text: `${angka(receivable.overdue_count)} tagihan terlambat · ${rupiah(receivable.overdue_total)}`,
      to: '/invoices',
    });
  }
  if (receivable.due_soon_count > 0) {
    alerts.push({
      tone: 'warn',
      icon: 'clock',
      text: `${angka(receivable.due_soon_count)} tagihan jatuh tempo dalam 7 hari`,
      to: '/invoices',
    });
  }
  if (onu.missing > 0) {
    alerts.push({
      tone: 'warn',
      icon: 'wifi',
      text: `${angka(onu.missing)} ONU tidak terlihat saat sync terakhir`,
      to: '/olt/onu',
    });
  }
  if (online.error) {
    alerts.push({ tone: 'warn', icon: 'activity', text: online.error });
  }
  if (online.unclassified > 0) {
    alerts.push({
      tone: 'info',
      icon: 'activity',
      text: `${angka(online.unclassified)} sesi terbuka tidak dikenali (akun tidak ada di RADIUS)`,
    });
  }
  if (alerts.length === 0) {
    alerts.push({ tone: 'info', icon: 'check-circle', text: 'Tidak ada peringatan aktif. Semua normal.' });
  }

  const toneWrap = {
    bad: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    info: 'border-slate-600/50 bg-slate-700/30 text-slate-300',
  } as const;

  return (
    <Section title="Peringatan sistem" subtitle="Hal yang perlu ditindaklanjuti">
      <ul className="space-y-2">
        {alerts.slice(0, 5).map((a, idx) => {
          const body = (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${toneWrap[a.tone]}`}
            >
              <Icon name={a.icon} className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{a.text}</span>
            </div>
          );
          return <li key={idx}>{a.to ? <Link to={a.to}>{body}</Link> : body}</li>;
        })}
      </ul>
    </Section>
  );
};

// Kerangka pemuatan penuh saat data pertama kali dimuat.
const DashboardSkeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SkeletonKpi />
      <SkeletonKpi />
      <SkeletonKpi />
      <SkeletonKpi />
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-72" />
    </div>
    <Skeleton className="h-32" />
  </div>
);

// ---- halaman ---------------------------------------------------------------

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const response = await api.get<DashboardData>('/api/dashboard');
      setData(response.data);
      setUpdatedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  if (loading && !data) {
    return (
      <>
        <DashboardHeader overdueCount={0} updatedAt={null} />
        <DashboardSkeleton />
      </>
    );
  }

  return (
    <>
      <DashboardHeader overdueCount={data?.receivable.overdue_count ?? 0} updatedAt={updatedAt} />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      {!data ? (
        <Loading label="Memuat dasbor…" />
      ) : (
        <div className="space-y-3">
          {/* KPI utama */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              to="/laporan"
              label="Pendapatan hari ini"
              value={rupiah(data.revenue.today_revenue)}
              icon="banknotes"
              tone="text-emerald-300"
              iconTone="bg-emerald-500/10 text-emerald-400"
              badge={<Badge tone="mute">{data.revenue.scope === 'all' ? 'semua' : 'milik Anda'}</Badge>}
            >
              <p>
                Tagihan {rupiah(data.revenue.today_payments)} · Voucher{' '}
                {rupiah(data.revenue.today_vouchers)}
              </p>
              <p className="text-slate-600">Bulan ini {rupiah(data.revenue.month_revenue)}</p>
            </KpiCard>

            <KpiCard
              to="/invoices"
              label="Piutang belum tertagih"
              value={rupiah(data.receivable.total)}
              icon="receipt"
              tone={data.receivable.overdue_count > 0 ? 'text-amber-300' : 'text-slate-100'}
              iconTone="bg-amber-500/10 text-amber-400"
              badge={
                <Badge tone={data.receivable.overdue_count > 0 ? 'bad' : 'mute'}>
                  {angka(data.receivable.overdue_count)} terlambat
                </Badge>
              }
            >
              <p>
                {angka(data.receivable.open_invoices)} tagihan terbuka dari{' '}
                {angka(data.total_invoices)} total
              </p>
              <p className={data.receivable.overdue_count > 0 ? 'text-rose-300' : 'text-slate-600'}>
                Lewat jatuh tempo {rupiah(data.receivable.overdue_total)}
              </p>
            </KpiCard>

            <KpiCard
              to="/sesi?jenis=ppp"
              label="PPPoE online"
              value={sesi(data.online.ppp)}
              icon="arrow-path"
              tone="text-cyan-300"
              iconTone="bg-cyan-500/10 text-cyan-400"
            >
              <p>Sesi PPPoE yang sedang tersambung</p>
              <p className="text-cyan-300/70">Lihat sesi →</p>
            </KpiCard>

            <KpiCard
              to="/sesi?jenis=hotspot&user_type=voucher"
              label="Hotspot online"
              value={sesi(data.online.hotspot)}
              icon="wifi"
              tone="text-cyan-300"
              iconTone="bg-cyan-500/10 text-cyan-400"
            >
              <p>
                Voucher {sesi(data.online.hotspot_voucher)} · Customer{' '}
                {sesi(data.online.hotspot_customer)}
              </p>
              <p className="text-cyan-300/70">Lihat sesi →</p>
            </KpiCard>
          </div>

          <p className="dash-note">
            Tiga angka ini berbeda: <span className="text-slate-200">pendapatan</span> dihitung dari
            kas masuk (pembayaran + voucher), <span className="text-slate-200">piutang</span> dari
            sisa tagihan belum lunas, dan <span className="text-slate-200">sesi online</span> dari
            accounting RADIUS yang hidup.
          </p>

          {/* Analitik keuangan + ringkasan tagihan */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueChart revenue={data.revenue} />
            </div>
            <BillingOverview data={data} />
          </div>

          {/* Jaringan + bisnis */}
          <NetworkStatus data={data} />
          <BusinessOverview data={data} />

          {/* Aktivitas + peringatan */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentActivities data={data} />
            </div>
            <SystemAlerts data={data} />
          </div>

          {/* Tagihan terlambat paling lama */}
          {data.receivable.oldest.length > 0 && (
            <Section
              title="Tagihan terlambat paling lama"
              subtitle="Belum lunas dan sudah lewat jatuh tempo"
              action={
                <Link to="/invoices" className="text-[11px] text-cyan-300 hover:text-cyan-200">
                  Lihat semua →
                </Link>
              }
            >
              <ul className="divide-y divide-slate-700/50">
                {data.receivable.oldest.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link
                        to={`/invoices?invoice=${invoice.id}`}
                        className="font-mono text-xs text-cyan-300 hover:underline"
                      >
                        {invoice.invoice_number}
                      </Link>
                      <p className="truncate text-sm text-slate-200">{invoice.customer_name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-sm text-slate-100">{rupiah(invoice.amount)}</p>
                      <p className="text-[11px] text-rose-300">{angka(invoice.days_late)} hari terlambat</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
};

export default Dashboard;
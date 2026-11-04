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
import { useAuth } from '../../contexts/AuthContext';
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

const HANDLER_EVENT_OPTS = [
  { value: 'ONU_LINKUP', label: '🟢 ONU up' },
  { value: 'ONU_LINKDOWN', label: '🔴 ONU down' },
  { value: 'ONU_REGISTER', label: '🔵 ONU registrasi' },
  { value: 'ONU_DEREGISTER', label: '🔴 ONU deregistrasi' },
  { value: 'ONU_DYING_GASP', label: '⚠️ ONU daya mati (dying gasp)' },
] as const;

const LogOnu: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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

  // Retensi terjadwal (penghapusan otomatis log lama).
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionMode, setRetentionMode] = useState<'age' | 'per_olt'>('age');
  const [retentionDays, setRetentionDays] = useState(30);
  const [retentionCount, setRetentionCount] = useState(500);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [retentionNote, setRetentionNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Konfigurasi event ONU (perbarui inventori + alert WhatsApp).
  const [handlersOpen, setHandlersOpen] = useState(false);
  const [handlerSync, setHandlerSync] = useState(false);
  const [handlerAlert, setHandlerAlert] = useState(false);
  const [handlerGroup, setHandlerGroup] = useState('');
  const [handlerEvents, setHandlerEvents] = useState<string[]>(['ONU_LINKDOWN', 'ONU_DYING_GASP']);
  const [handlerCooldown, setHandlerCooldown] = useState(10);
  const [handlerBusy, setHandlerBusy] = useState(false);
  const [handlerNote, setHandlerNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

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

  const openRetention = async () => {
    setRetentionNote(null);
    try {
      const response = await api.get('/api/olt/syslog/retention');
      const policy = (response.data as { policy: { mode: 'age' | 'per_olt'; days?: number; count?: number } }).policy;
      setRetentionMode(policy.mode ?? 'age');
      setRetentionDays(policy.days ?? 30);
      setRetentionCount(policy.count ?? 500);
    } catch {
      // pakai nilai bawaan bila belum pernah diset
    }
    setRetentionOpen(true);
  };

  const saveRetention = async () => {
    setRetentionBusy(true);
    setRetentionNote(null);
    try {
      const body = retentionMode === 'per_olt' ? { mode: 'per_olt', count: retentionCount } : { mode: 'age', days: retentionDays };
      const response = await api.post('/api/olt/syslog/retention', body);
      const data = response.data as { policy: { mode: 'age' | 'per_olt'; days?: number; count?: number }; removed: number };
      setRetentionNote({
        tone: 'ok',
        text:
          `Kebijakan tersimpan — ${data.policy.mode === 'age' ? `hapus log > ${data.policy.days} hari` : `simpan ${data.policy.count} terbaru per OLT`}. ` +
          `${data.removed} log lama dihapus sekarang.`,
      });
      logs.reload();
    } catch (error) {
      setRetentionNote({ tone: 'bad', text: readError(error, 'Gagal menyimpan kebijakan.') });
    } finally {
      setRetentionBusy(false);
    }
  };

  const openHandlers = async () => {
    setHandlerNote(null);
    try {
      const response = await api.get('/api/olt/syslog/handlers');
      const config = (response.data as {
        config: {
          inventory_sync: boolean;
          whatsapp_alert: boolean;
          whatsapp_group: string;
          alert_events: string[];
          cooldown_minutes: number;
        };
      }).config;
      setHandlerSync(config.inventory_sync);
      setHandlerAlert(config.whatsapp_alert);
      setHandlerGroup(config.whatsapp_group ?? '');
      setHandlerEvents(config.alert_events ?? []);
      setHandlerCooldown(config.cooldown_minutes ?? 10);
    } catch {
      // pakai nilai bawaan bila belum pernah diset
    }
    setHandlersOpen(true);
  };

  const toggleHandlerEvent = (event: string) => {
    setHandlerEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  };

  const saveHandlers = async () => {
    setHandlerBusy(true);
    setHandlerNote(null);
    try {
      await api.post('/api/olt/syslog/handlers', {
        inventory_sync: handlerSync,
        whatsapp_alert: handlerAlert,
        whatsapp_group: handlerGroup,
        alert_events: handlerEvents,
        cooldown_minutes: handlerCooldown,
      });
      setHandlerNote({ tone: 'ok', text: 'Konfigurasi event tersimpan.' });
    } catch (error) {
      setHandlerNote({ tone: 'bad', text: readError(error, 'Gagal menyimpan konfigurasi.') });
    } finally {
      setHandlerBusy(false);
    }
  };

  if (devices.loading && logs.loading) return <Loading label="Memuat log ONU…" />;

  return (
    <div className="page-container">
      <PageHeader
        title="Log ONU"
        subtitle="Alur kejadian ONU yang diterima dari OLT (linkup, linkdown, registrasi, dying gasp, login). Sumber: kolektor syslog internal."
        actions={
          <>
            {isAdmin && <Button onClick={openHandlers}>Konfigurasi Event</Button>}
            {isAdmin && <Button onClick={openRetention}>Penghapusan Terjadwal</Button>}
            <Button onClick={logs.reload} disabled={logs.refreshing}>
              {logs.refreshing ? 'Memuat…' : 'Muat ulang'}
            </Button>
          </>
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

      {retentionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Penghapusan Terjadwal</h2>
              <p className="mt-1 text-xs text-slate-400">
                Hapus otomatis log ONU lama. Kebijakan dijalankan berkala (tiap jam) dan juga langsung saat disimpan.
              </p>
            </div>

            {retentionNote && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm ${
                  retentionNote.tone === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-500/40 bg-red-500/10 text-red-300'
                }`}
              >
                {retentionNote.text}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="radio"
                name="retention-mode"
                checked={retentionMode === 'age'}
                onChange={() => setRetentionMode('age')}
              />
              Berdasarkan umur log
            </label>
            {retentionMode === 'age' && (
              <select
                value={retentionDays}
                onChange={(event) => setRetentionDays(Number(event.target.value))}
                className="w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              >
                <option value={1}>1 hari</option>
                <option value={7}>7 hari</option>
                <option value={30}>30 hari</option>
              </select>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="radio"
                name="retention-mode"
                checked={retentionMode === 'per_olt'}
                onChange={() => setRetentionMode('per_olt')}
              />
              Berdasarkan jumlah per OLT
            </label>
            {retentionMode === 'per_olt' && (
              <input
                type="number"
                value={retentionCount}
                onChange={(event) => setRetentionCount(Number(event.target.value))}
                min={1}
                max={100000}
                placeholder="500"
                className="w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
              />
            )}
            <p className="text-[11px] text-slate-500">
              {retentionMode === 'per_olt'
                ? `Pertahankan ${retentionCount} log terbaru untuk setiap OLT; sisanya dihapus otomatis.`
                : `Hapus log ONU yang lebih tua dari ${retentionDays} hari.`}
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setRetentionOpen(false)} disabled={retentionBusy}>
                Batal
              </Button>
              <Button variant="primary" onClick={saveRetention} disabled={retentionBusy}>
                {retentionBusy ? 'Menyimpan…' : 'Simpan & jalankan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {detail && <LogDetailModal row={detail} onClose={() => setDetail(null)} />}

      {handlersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Konfigurasi Event ONU</h2>
              <p className="mt-1 text-xs text-slate-400">
                Saat log ONU up/down/daya mati masuk dari OLT, panel dapat memperbarui inventori dan mengirim alert WhatsApp.
              </p>
            </div>

            {handlerNote && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm ${
                  handlerNote.tone === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-500/40 bg-red-500/10 text-red-300'
                }`}
              >
                {handlerNote.text}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={handlerSync}
                onChange={(event) => setHandlerSync(event.target.checked)}
              />
              Perbarui inventori ONU (online/offline + jejak event)
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={handlerAlert}
                onChange={(event) => setHandlerAlert(event.target.checked)}
              />
              Kirim alert WhatsApp
            </label>

            {handlerAlert && (
              <>
                <label className="block text-xs text-slate-300">
                  ID grup WhatsApp
                  <input
                    value={handlerGroup}
                    onChange={(event) => setHandlerGroup(event.target.value)}
                    placeholder="123456789@g.us"
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ambil dari WhatsApp Gateway → Keamanan &amp; Akses (entri grup).
                  </p>
                </label>

                <div className="text-sm text-slate-200">
                  <p className="mb-1 text-xs font-medium text-slate-300">Beri tahu saat:</p>
                  <div className="flex flex-col gap-1.5">
                    {HANDLER_EVENT_OPTS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={handlerEvents.includes(opt.value)}
                          onChange={() => toggleHandlerEvent(opt.value)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <label className="block text-xs text-slate-300">
                  Jeda antar pesan (menit)
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={handlerCooldown}
                    onChange={(event) =>
                      setHandlerCooldown(Math.max(1, Math.min(60, Number(event.target.value) || 10)))
                    }
                    className="mt-1 w-24 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    ONU yang bolak-balik mati/hidup dalam jeda ini dirangkum jadi satu pesan (flap), bukan spam.
                  </p>
                </label>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setHandlersOpen(false)} disabled={handlerBusy}>
                Batal
              </Button>
              <Button variant="primary" onClick={saveHandlers} disabled={handlerBusy}>
                {handlerBusy ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        </div>
      )}
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
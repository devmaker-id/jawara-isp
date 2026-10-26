import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  errorMessage,
} from '../../components/net/NetUI';

// Halaman Konfigurasi FreeRADIUS.
//
// Semua nilai di sini dikelola lewat helper sudo sempit di server
// (/usr/local/sbin/jawara-radius-config). Panel tidak menyimpan password
// database RADIUS: helper membuat dan menyimpannya sendiri, status yang
// ditampilkan hanya "dikelola server".

interface Settings {
  listen_address: string;
  auth_port: number;
  acct_port: number;
  db_host: string;
  db_port: number;
  db_name: string;
  db_user: string;
  read_clients: boolean;
  timezone: string;
}

interface ClockRead {
  epoch?: number;
  local?: string;
  now?: string;
  utc?: string;
  timezone?: string;
  ok?: boolean;
  error?: string;
}

// Zona yang lazim dipakai di Indonesia; nilai lain di luar daftar tetap
// ditampilkan bila server sudah memakainya.
const ZONES = ['Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'];

interface ConfigRead {
  ok: boolean;
  settings: Settings;
  server_time?: ClockRead;
  database_time?: ClockRead | null;
  db_password: 'managed' | 'missing';
  helper_installed: boolean;
  probe: {
    installed: boolean;
    service: string;
    site_enabled: boolean;
    sql_module_enabled: boolean;
  };
}

interface ApplyResult {
  ok: boolean;
  settings: Settings;
  reloaded: boolean;
  service: string;
  validation: string[];
  db_user_ready: boolean;
  db_error: string | null;
}

const Konfigurasi: React.FC = () => {
  const [data, setData] = useState<ConfigRead | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<ConfigRead>('/api/freeradius/config');
      setData(response.data);
      setForm(response.data.settings);
      setReason(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const apply = () =>
    run('apply', async () => {
      if (!form) return;
      setResult(null);
      setLog([]);
      const response = await api.post<ApplyResult>('/api/freeradius/config', form);
      setResult(response.data);
      setLog(response.data.validation ?? []);
      await load();
    });

  const validate = () =>
    run('validate', async () => {
      const response = await api.post<{ valid: boolean; output: string[] }>(
        '/api/freeradius/config/validate',
      );
      setLog(response.data.output ?? []);
      setReason(
        response.data.valid
          ? 'Konfigurasi saat ini diterima FreeRADIUS.'
          : 'Konfigurasi saat ini DITOLAK FreeRADIUS.',
      );
    });

  const control = (action: 'start' | 'stop' | 'restart' | 'reload') =>
    run(action, async () => {
      await api.post('/api/freeradius/config/service', { action });
      await load();
    });

  const debug = () =>
    run('debug', async () => {
      setReason('Menjalankan freeradius -X selama ±10 detik. Service berhenti sementara.');
      const response = await api.post<{ output: string[] }>('/api/freeradius/config/debug');
      setLog(response.data.output ?? []);
      setReason('Selesai. Service dinyalakan kembali.');
      await load();
    });

  return (
    <div className="page-container">
      <PageHeader
        title="FreeRADIUS — Konfigurasi"
        subtitle="Server RADIUS mengambil user, grup, sesi, dan daftar NAS sepenuhnya dari database."
        actions={<Button onClick={() => void load()}>Muat ulang</Button>}
      />

      {loading && <Loading label="Memuat konfigurasi…" />}
      {error && <div className="mb-4"><ErrorNote message={error} onRetry={() => void load()} /></div>}

      {data && form && !loading && (
        <>
          {!data.helper_installed && (
            <div className="mb-4">
              <InfoNote tone="warn">
                Helper konfigurasi belum dipasang di server. Jalankan sekali dari terminal server:
                {'\n'}sudo bash deploy/setup-helper.sh
              </InfoNote>
            </div>
          )}

          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={data.probe.installed ? 'good' : 'bad'}>
                {data.probe.installed ? 'terpasang' : 'belum terpasang'}
              </Badge>
              <Badge tone={data.probe.service === 'active' ? 'good' : 'warn'}>
                service {data.probe.service}
              </Badge>
              <Badge tone={data.probe.site_enabled ? 'good' : 'warn'}>
                site {data.probe.site_enabled ? 'terkelola' : 'bawaan'}
              </Badge>
              <Badge tone={data.probe.sql_module_enabled ? 'good' : 'warn'}>
                modul sql {data.probe.sql_module_enabled ? 'aktif' : 'nonaktif'}
              </Badge>
              <Badge tone={data.db_password === 'managed' ? 'good' : 'bad'}>
                password DB {data.db_password === 'managed' ? 'dikelola server' : 'belum ada'}
              </Badge>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Port listen</p>
              <label className="block text-xs text-slate-400 mb-1">Alamat listen</label>
              <input
                value={form.listen_address}
                onChange={(e) => patch('listen_address', e.target.value)}
                className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                placeholder="*"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Port auth</label>
                  <input
                    type="number"
                    value={form.auth_port}
                    onChange={(e) => patch('auth_port', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Port acct</label>
                  <input
                    type="number"
                    value={form.acct_port}
                    onChange={(e) => patch('acct_port', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                </div>
              </div>
            </Card>

            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Database</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Host</label>
                  <input
                    value={form.db_host}
                    onChange={(e) => patch('db_host', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={form.db_port}
                    onChange={(e) => patch('db_port', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nama database</label>
                  <input
                    value={form.db_name}
                    onChange={(e) => patch('db_name', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">User database</label>
                  <input
                    value={form.db_user}
                    onChange={(e) => patch('db_user', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Password user ini dibuat dan disimpan di server (root:freerad 0640). Panel tidak
                pernah menerima nilainya.
              </p>
            </Card>
          </div>

          <Card className="mt-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={form.read_clients}
                onChange={(e) => patch('read_clients', e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm text-slate-200">
                Baca daftar NAS dari database
                <span className="block text-xs text-slate-400">
                  Bila aktif, NAS dikelola dari menu FreeRADIUS → NAS. clients.conf dikosongkan agar
                  hanya ada satu sumber kebenaran.
                </span>
              </span>
            </label>
          </Card>

          <Card className="mt-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Waktu & zona waktu</p>
            <label className="block text-xs text-slate-400 mb-1">Zona waktu server</label>
            <select
              value={form.timezone}
              onChange={(e) => patch('timezone', e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100"
            >
              {(ZONES.includes(form.timezone) ? ZONES : [form.timezone, ...ZONES]).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-slate-400 mb-1">Jam server RADIUS</p>
                <p className="font-mono text-slate-100">
                  {data.server_time?.local ?? '—'}{' '}
                  <span className="text-slate-400">{data.server_time?.timezone ?? data.settings.timezone}</span>
                </p>
                <p className="font-mono text-slate-500">UTC {data.server_time?.utc ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-slate-400 mb-1">Jam database (sumber acctstarttime)</p>
                <p className="font-mono text-slate-100">
                  {data.database_time?.now ?? '—'}{' '}
                  <span className="text-slate-400">{data.database_time?.timezone ?? ''}</span>
                </p>
                <p className="font-mono text-slate-500">
                  {data.database_time?.ok === false
                    ? `tidak terbaca: ${data.database_time?.error ?? 'tanpa keterangan'}`
                    : `UTC ${data.database_time?.utc ?? '—'}`}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              acctstarttime diisi MariaDB dari Event-Timestamp perangkat (FROM_UNIXTIME), jadi jam
              radacct mengikuti zona waktu database — bukan zona proses freeradius. Zona server
              dipakai untuk jam log. Selisih jam perangkat diperiksa saat menambah NAS.
            </p>
          </Card>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void apply()} disabled={busy !== null}>
              {busy === 'apply' ? 'Menerapkan…' : 'Terapkan'}
            </Button>
            <Button onClick={() => void validate()} disabled={busy !== null}>
              {busy === 'validate' ? 'Memeriksa…' : 'Uji konfigurasi'}
            </Button>
            <Button onClick={() => void debug()} disabled={busy !== null}>
              {busy === 'debug' ? 'Menjalankan…' : 'Diagnostik (-X)'}
            </Button>
            <Button onClick={() => void control('reload')} disabled={busy !== null}>
              Muat ulang service
            </Button>
            <Button onClick={() => void control('restart')} disabled={busy !== null}>
              Restart
            </Button>
            <Button variant="danger" onClick={() => void control('stop')} disabled={busy !== null}>
              Hentikan
            </Button>
            <Button onClick={() => void control('start')} disabled={busy !== null}>
              Mulai
            </Button>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Restart memuat ulang daftar NAS dari database (wajib setelah menambah/menghapus NAS).
            Muat ulang service hanya membaca ulang file konfigurasi, tanpa memuat ulang daftar NAS.
          </p>

          {reason && <p className="mt-3 text-xs text-slate-300">{reason}</p>}

          {result && (
            <div className="mt-4">
              <InfoNote tone={result.validation.some((l) => /OK|appears/i.test(l)) ? 'info' : 'warn'}>
                {`Diterapkan. Service: ${result.service}. Reload otomatis: ${result.reloaded ? 'ya' : 'tidak'}.`}
                {result.db_error ? `\nCatatan database: ${result.db_error}` : ''}
              </InfoNote>
            </div>
          )}

          {log.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Keluaran</p>
              <div
                data-testid="config-log"
                className="h-64 overflow-auto rounded-lg border border-slate-700 bg-black/80 p-3 font-mono text-[11px] leading-relaxed text-slate-200"
              >
                {log.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Konfigurasi;

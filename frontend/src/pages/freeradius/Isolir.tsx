import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  Table,
  errorMessage,
} from '../../components/net/NetUI';

// Profil ISOLIR untuk PPPoE.
//
// Pelanggan yang kehabisan batas waktu/kuota atau menunggak dipindahkan grup
// RADIUS-nya ke grup isolir, sehingga mendapat alamat dari 10.127.0.0/18 dan
// hanya bisa membuka halaman isolir. Halaman ini mengatur parameternya dan
// menghasilkan perintah MikroTik untuk dipasang operator.

interface IsolirConfig {
  enabled: boolean;
  group: string;
  pool_name: string;
  cidr: string;
  gateway: string;
  range_start: string;
  range_end: string;
  rate_limit: string;
  url: string;
  message: string;
}

interface IsolirStatus {
  config: IsolirConfig;
  counts: { total: number; ppp: number; blocked: number };
  accounts: Array<{
    username: string;
    customer_name: string | null;
    block_reason: string | null;
    isolir_at: string;
  }>;
  group_attributes: Array<{ attribute: string; op: string; value: string }>;
}

interface Device {
  id: number;
  name: string;
  host: string;
}

const REASON_LABEL: Record<string, string> = {
  time: 'Waktu online habis',
  quota: 'Kuota habis',
  validity: 'Masa aktif habis',
  bill: 'Tagihan belum dibayar',
};

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';

const Isolir: React.FC = () => {
  const [status, setStatus] = useState<IsolirStatus | null>(null);
  const [form, setForm] = useState<IsolirConfig | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [commands, setCommands] = useState<Array<{ command: string; note: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data }, deviceList] = await Promise.all([
        api.get<IsolirStatus>('/api/freeradius/isolir'),
        api.get<{ rows: Device[] }>('/api/mikrotik/devices'),
      ]);
      setStatus(data);
      setForm(data.config);
      const rows = Array.isArray(deviceList.data) ? deviceList.data : deviceList.data?.rows ?? [];
      setDevices(rows);
      setDeviceId((current) => current || (rows[0] ? String(rows[0].id) : ''));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const save = async () => {
    if (!form) return;
    setBusy('save');
    setError(null);
    try {
      await api.put('/api/freeradius/isolir', form);
      setToast('Konfigurasi isolir disimpan.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const syncAttributes = async () => {
    setBusy('sync');
    setError(null);
    try {
      const { data } = await api.post<{ group: string; attributes: number }>(
        '/api/freeradius/isolir/sync',
      );
      setToast(`${data.attributes} atribut grup "${data.group}" ditulis ke radgroupreply.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const provision = async () => {
    if (!deviceId) return;
    setBusy('provision');
    setError(null);
    try {
      const { data } = await api.post<{ provisioning: { action: string; message: string } }>(
        '/api/freeradius/isolir/provision',
        { device_id: Number(deviceId) },
      );
      setToast(`Penyiapan perangkat: ${data.provisioning.action} — ${data.provisioning.message}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const loadCommands = async () => {
    setBusy('commands');
    setError(null);
    try {
      const { data } = await api.get<{ commands: Array<{ command: string; note: string }> }>(
        '/api/freeradius/isolir/commands',
      );
      setCommands(data.commands);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="page-container"><Loading label="Memuat profil isolir…" /></div>;
  if (!form) {
    return (
      <div className="page-container">
        {error && <ErrorNote message={error} onRetry={() => void load()} />}
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        title="FreeRADIUS — Profil Isolir"
        subtitle="Pelanggan PPPoE yang kehabisan batas atau menunggak dipindah ke grup ini: IP dari 10.127.0.0/18 dan hanya halaman isolir yang bisa dibuka."
        actions={
          <Button variant="primary" onClick={() => void save()} disabled={busy !== null}>
            {busy === 'save' ? 'Menyimpan…' : 'Simpan'}
          </Button>
        }
      />

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {toast}
        </div>
      )}
      {error && <div className="mb-3"><ErrorNote message={error} onRetry={() => void load()} /></div>}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">Parameter</p>
          <Badge tone={form.enabled ? 'good' : 'mute'}>
            {form.enabled ? 'aktif' : 'nonaktif'}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="mr-2"
              />
              Aktifkan isolir (kalau dimatikan, penegak tidak memindahkan pelanggan)
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Nama grup isolir</label>
            <input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}
              className={`${inputClass} font-mono`} />
            <p className="mt-1 text-[11px] text-slate-500">
              Nama ini jadi kunci <code>radgroupreply</code> dan nama profil PPP lokal.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Nama IP pool</label>
            <input value={form.pool_name} onChange={(e) => setForm({ ...form, pool_name: e.target.value })}
              className={`${inputClass} font-mono`} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">CIDR isolir</label>
            <input value={form.cidr} onChange={(e) => setForm({ ...form, cidr: e.target.value })}
              className={`${inputClass} font-mono`} placeholder="10.127.0.0/18" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Gateway (di luar pool)</label>
            <input value={form.gateway} onChange={(e) => setForm({ ...form, gateway: e.target.value })}
              className={`${inputClass} font-mono`} placeholder="10.127.0.1" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">IP awal pool</label>
            <input value={form.range_start} onChange={(e) => setForm({ ...form, range_start: e.target.value })}
              className={`${inputClass} font-mono`} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">IP akhir pool</label>
            <input value={form.range_end} onChange={(e) => setForm({ ...form, range_end: e.target.value })}
              className={`${inputClass} font-mono`} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Rate limit isolir</label>
            <input value={form.rate_limit} onChange={(e) => setForm({ ...form, rate_limit: e.target.value })}
              className={`${inputClass} font-mono`} placeholder="512k/512k" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">URL halaman isolir</label>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              className={`${inputClass} font-mono`} placeholder="https://isolir.contoh.net/" />
            <p className="mt-1 text-[11px] text-slate-500">
              Boleh dikosongkan. Perintah redirect memakai host dari URL ini.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Pesan untuk pelanggan</label>
            <textarea value={form.message} rows={2}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className={`${inputClass} resize-y`} />
          </div>
        </div>
      </Card>

      <div className="mt-3">
        <Card>
          <p className="text-sm font-semibold text-slate-200">Terapkan ke perangkat</p>
          <p className="mt-1 text-xs text-slate-400">
            Menyiapkan <code>/ip/pool</code> dan <code>/ppp/profile</code> isolir di router, lalu
            menulis atribut grup ke <code>radgroupreply</code>. Firewall/redirect tidak dijalankan
            otomatis — perintahnya di bawah untuk Anda periksa.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}
              className={`${inputClass} sm:max-w-xs`}>
              <option value="">Pilih perangkat…</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.host})
                </option>
              ))}
            </select>
            <Button onClick={() => void provision()} disabled={busy !== null || !deviceId}>
              {busy === 'provision' ? 'Menyiapkan…' : 'Siapkan pool + profil'}
            </Button>
            <Button onClick={() => void syncAttributes()} disabled={busy !== null}>
              {busy === 'sync' ? 'Menulis…' : 'Tulis atribut grup'}
            </Button>
            <Button onClick={() => void loadCommands()} disabled={busy !== null}>
              {busy === 'commands' ? 'Menyusun…' : 'Perintah firewall'}
            </Button>
          </div>

          {status && status.group_attributes.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-700 bg-black/60 p-3 font-mono text-[11px] text-cyan-200">
              {status.group_attributes.map((row) => (
                <div key={row.attribute}>
                  {row.attribute} {row.op} {row.value}
                </div>
              ))}
            </div>
          )}

          {commands.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-slate-400">
                Jalankan manual di terminal MikroTik. Aturan firewall menyentuh jalur produksi —
                periksa urutannya sebelum dipasang.
              </p>
              <div className="space-y-2">
                {commands.map((item, index) => (
                  <div key={index} className="rounded-lg border border-slate-700 bg-black/70 p-2">
                    <pre className="overflow-x-auto font-mono text-[11px] text-cyan-200">{item.command}</pre>
                    <p className="mt-1 text-[11px] text-slate-500">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {status && (
        <div className="mt-3">
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-200">Pelanggan di isolir</p>
              <div className="flex gap-2 text-xs">
                <Badge tone="warn">{status.counts.total} akun</Badge>
                <Badge tone="mute">{status.counts.ppp} PPPoE</Badge>
              </div>
            </div>
            <Table
              columns={['Akun', 'Pelanggan', 'Sebab', 'Sejak']}
              isEmpty={status.accounts.length === 0}
              empty="Tidak ada pelanggan di isolir."
            >
              {status.accounts.map((row) => (
                <tr key={row.username}>
                  <td className="px-3 py-2 font-mono text-xs">{row.username}</td>
                  <td className="px-3 py-2 text-xs">{row.customer_name ?? '-'}</td>
                  <td className="px-3 py-2 text-xs">
                    {REASON_LABEL[row.block_reason ?? ''] ?? row.block_reason ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {new Date(row.isolir_at).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-[11px] text-slate-500">
              Pelanggan keluar dari isolir otomatis saat tagihannya lunas, atau manual lewat
              <code> POST /api/freeradius/isolir/release</code>.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Isolir;

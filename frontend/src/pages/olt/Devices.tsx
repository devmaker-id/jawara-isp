import React, { useMemo, useState } from 'react';
import api from '../../services/api';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  StatCard,
  Table,
  errorMessage,
  formatNumber,
  useNet,
} from '../../components/net/NetUI';
import { RowActions } from '../../components/table/RowActions';
import { useAuth } from '../../contexts/AuthContext';

interface OltDevice {
  id: number;
  name: string;
  vendor: string;
  transport: 'ssh' | 'telnet';
  host: string;
  port: number;
  username: string;
  pon_ports: string;
  prompt_pattern: string | null;
  is_active: boolean;
  read_only: boolean;
  has_enable_password: boolean;
  last_checked_at: string | null;
  last_connected: boolean | null;
  last_message: string | null;
  last_identity: string | null;
  onu_total: number;
  onu_online: number;
}

interface DevicePayload {
  rows: OltDevice[];
  vendors: string[];
}

interface FormState {
  id?: number;
  name: string;
  vendor: string;
  transport: 'ssh' | 'telnet';
  host: string;
  port: string;
  username: string;
  password: string;
  enable_password: string;
  pon_ports: string;
  prompt_pattern: string;
  is_active: boolean;
}

interface SyslogState {
  enabled: boolean;
  collectorIp: string | null;
  collectorPort: number;
  readBack: string | null;
}

interface SyslogResult {
  before: SyslogState;
  after: SyslogState;
  verified: boolean;
}

const emptyForm = (vendor = 'vsol'): FormState => ({
  name: '',
  vendor,
  transport: 'ssh',
  host: '',
  port: '22',
  username: '',
  password: '',
  enable_password: '',
  pon_ports: '0/1',
  prompt_pattern: '',
  is_active: true,
});

const formFrom = (device: OltDevice): FormState => ({
  id: device.id,
  name: device.name,
  vendor: device.vendor,
  transport: device.transport,
  host: device.host,
  port: String(device.port),
  username: device.username,
  password: '',
  enable_password: '',
  pon_ports: device.pon_ports,
  prompt_pattern: device.prompt_pattern ?? '',
  is_active: device.is_active,
});

const waktu = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/**
 * Manajemen perangkat OLT.
 *
 * Panel hanya membaca perangkat. Tombol "Uji" membuka sesi lalu menutupnya;
 * "Sinkron" membaca inventori ONU dan menyimpannya. Tidak ada aksi yang
 * mengubah konfigurasi OLT.
 */
const OltDevices: React.FC = () => {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'operator';
  const canDelete = user?.role === 'admin';

  const devices = useNet<DevicePayload>('/api/olt/devices');
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ===== modal Syslog Client =====
  const canWriteSyslog = user?.role === 'admin';
  const [syslogDevice, setSyslogDevice] = useState<OltDevice | null>(null);
  const [syslogState, setSyslogState] = useState<SyslogState | null>(null);
  const [syslogEnabled, setSyslogEnabled] = useState(true);
  const [syslogIp, setSyslogIp] = useState('');
  const [syslogBusy, setSyslogBusy] = useState(false);
  const [syslogNote, setSyslogNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [syslogResult, setSyslogResult] = useState<SyslogResult | null>(null);

  const rows = devices.data?.rows ?? [];
  const vendors = devices.data?.vendors ?? ['vsol'];

  const totals = useMemo(
    () => ({
      devices: rows.length,
      onu: rows.reduce((sum, row) => sum + row.onu_total, 0),
      online: rows.reduce((sum, row) => sum + row.onu_online, 0),
      offline: rows.filter((row) => row.last_connected === false).length,
    }),
    [rows],
  );

  const save = async () => {
    if (!form) return;
    setBusy('save');
    setToast(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        vendor: form.vendor,
        transport: form.transport,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        pon_ports: form.pon_ports,
        prompt_pattern: form.prompt_pattern,
        is_active: form.is_active,
      };
      // Password kosong saat mengubah berarti "jangan ubah".
      if (form.password) body.password = form.password;
      if (form.enable_password) body.enable_password = form.enable_password;

      if (form.id) await api.patch(`/api/olt/devices/${form.id}`, body);
      else await api.post('/api/olt/devices', body);

      setForm(null);
      setToast({ kind: 'ok', text: form.id ? 'Perangkat diperbarui.' : 'Perangkat ditambahkan.' });
      devices.reload();
    } catch (error) {
      setToast({ kind: 'err', text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const run = async (device: OltDevice, action: 'test' | 'sync') => {
    setBusy(`${action}-${device.id}`);
    setToast(null);
    try {
      const response = await api.post(`/api/olt/devices/${device.id}/${action}`);
      const data = response.data as {
        onu_total?: number;
        onu_online?: number;
        port?: string;
        message?: string;
        duration_ms?: number;
      };
      setToast({
        kind: 'ok',
        text:
          action === 'test'
            ? `Uji berhasil: ${data.onu_total ?? 0} ONU di port ${data.port} (${data.onu_online ?? 0} online).`
            : `Sinkron selesai: ${data.onu_total ?? 0} ONU (${data.onu_online ?? 0} online) dalam ${Math.round(
                (data.duration_ms ?? 0) / 1000,
              )} detik.`,
      });
      devices.reload();
    } catch (error) {
      setToast({ kind: 'err', text: errorMessage(error) });
      devices.reload();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (device: OltDevice) => {
    const ok = window.confirm(
      `Hapus perangkat "${device.name}"? Inventori ${device.onu_total} ONU miliknya ikut terhapus dari panel. ` +
        'Perangkat OLT sendiri tidak berubah.',
    );
    if (!ok) return;
    setBusy(`delete-${device.id}`);
    try {
      await api.delete(`/api/olt/devices/${device.id}`);
      setToast({ kind: 'ok', text: 'Perangkat dihapus.' });
      devices.reload();
    } catch (error) {
      setToast({ kind: 'err', text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const openSyslog = async (device: OltDevice) => {
    setSyslogDevice(device);
    setSyslogState(null);
    setSyslogResult(null);
    setSyslogNote(null);
    setSyslogEnabled(true);
    setSyslogIp('');
    setSyslogBusy(true);
    try {
      const response = await api.get(`/api/olt/devices/${device.id}/syslog`);
      const data = response.data as { state: SyslogState; vendor: string };
      setSyslogState(data.state);
      setSyslogEnabled(data.state.enabled);
      if (data.state.collectorIp) setSyslogIp(data.state.collectorIp);
    } catch (error) {
      setSyslogNote({ kind: 'err', text: errorMessage(error) });
    } finally {
      setSyslogBusy(false);
    }
  };

  const applySyslog = async () => {
    if (!syslogDevice) return;
    setSyslogBusy(true);
    setSyslogNote(null);
    setSyslogResult(null);
    try {
      const response = await api.post(`/api/olt/devices/${syslogDevice.id}/syslog`, {
        enabled: syslogEnabled,
        collector_ip: syslogEnabled ? syslogIp : undefined,
      });
      setSyslogResult(response.data as SyslogResult);
      setSyslogState((response.data as SyslogResult).after);
      setSyslogNote({
        kind: (response.data as SyslogResult).verified ? 'ok' : 'err',
        text: (response.data as SyslogResult).verified
          ? 'Berhasil diterapkan dan terverifikasi di perangkat.'
          : 'Diterapkan, tetapi read-back belum cocok — periksa hasil di bawah.',
      });
      devices.reload();
    } catch (error) {
      setSyslogNote({ kind: 'err', text: errorMessage(error) });
    } finally {
      setSyslogBusy(false);
    }
  };

  const rollbackSyslog = async () => {
    if (!syslogDevice) return;
    setSyslogBusy(true);
    setSyslogNote(null);
    setSyslogResult(null);
    try {
      const response = await api.post(`/api/olt/devices/${syslogDevice.id}/syslog/rollback`);
      setSyslogResult(response.data as SyslogResult);
      setSyslogState((response.data as SyslogResult).after);
      setSyslogNote({ kind: 'ok', text: 'Rollback selesai ke snapshot sebelumnya.' });
      devices.reload();
    } catch (error) {
      setSyslogNote({ kind: 'err', text: errorMessage(error) });
    } finally {
      setSyslogBusy(false);
    }
  };

  if (devices.loading) return <Loading label="Memuat perangkat OLT…" />;

  return (
    <div className="page-container">
      <PageHeader
        title="Perangkat OLT"
        subtitle="Inventori ONU dibaca langsung dari perangkat lewat SSH/telnet (baca-saja). Pengaturan Syslog Client OLT lewat aksi 'Syslog Client'."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setForm(emptyForm(vendors[0]))}>
              Tambah OLT
            </Button>
          ) : undefined
        }
      />

      {devices.error && <ErrorNote message={devices.error} onRetry={devices.reload} />}

      {toast && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <StatCard label="Perangkat" value={formatNumber(totals.devices)} />
        <StatCard label="ONU terbaca" value={formatNumber(totals.onu)} />
        <StatCard label="ONU online" value={formatNumber(totals.online)} tone="good" />
        <StatCard
          label="Gagal koneksi"
          value={formatNumber(totals.offline)}
          tone={totals.offline > 0 ? 'bad' : 'default'}
          hint="Dari pemeriksaan terakhir"
        />
      </div>

      <Table
        columns={['Perangkat', 'Alamat', 'Driver', 'ONU', 'Pemeriksaan terakhir', '']}
        isEmpty={rows.length === 0}
        empty="Belum ada perangkat OLT. Tambahkan satu untuk mulai membaca inventori."
      >
        {rows.map((device) => (
          <tr key={device.id} className="align-top hover:bg-slate-800/40">
            <td className="px-3 py-2">
              <p className="font-medium text-white">{device.name}</p>
              <p className="text-[11px] text-slate-400">
                {device.last_identity ? `prompt: ${device.last_identity}` : 'belum pernah terhubung'}
              </p>
            </td>
            <td className="px-3 py-2 font-mono text-xs text-slate-300">
              {device.host}:{device.port}
              <span className="ml-1 text-slate-500">{device.transport}</span>
            </td>
            <td className="px-3 py-2 text-xs text-slate-300">
              {device.vendor}
              <p className="text-[11px] text-slate-500">PON {device.pon_ports}</p>
            </td>
            <td className="px-3 py-2 text-xs">
              <span className="text-emerald-300">{formatNumber(device.onu_online)}</span>
              <span className="text-slate-500"> / {formatNumber(device.onu_total)}</span>
              <p className="text-[11px] text-slate-500">online / total</p>
            </td>
            <td className="px-3 py-2 text-xs">
              {device.last_connected === null ? (
                <Badge tone="mute">belum diperiksa</Badge>
              ) : device.last_connected ? (
                <Badge tone="good">terhubung</Badge>
              ) : (
                <Badge tone="bad">gagal</Badge>
              )}
              <p className="mt-1 text-[11px] text-slate-500">{waktu(device.last_checked_at)}</p>
              {device.last_message && (
                <p className="mt-0.5 max-w-xs truncate text-[11px] text-slate-400" title={device.last_message}>
                  {device.last_message}
                </p>
              )}
            </td>
            <td className="actions">
              <RowActions
                label={`Aksi untuk ${device.name}`}
                actions={[
                  {
                    key: 'test',
                    label: busy === `test-${device.id}` ? 'Menguji…' : 'Uji koneksi',
                    disabled: busy !== null,
                    hidden: !canWrite,
                    onSelect: () => run(device, 'test'),
                  },
                  {
                    key: 'sync',
                    label: busy === `sync-${device.id}` ? 'Membaca…' : 'Sinkron inventori',
                    disabled: busy !== null || !device.is_active,
                    hidden: !canWrite,
                    onSelect: () => run(device, 'sync'),
                  },
                  {
                    key: 'syslog',
                    label: 'Syslog Client',
                    disabled: busy !== null,
                    onSelect: () => openSyslog(device),
                  },
                  {
                    key: 'edit',
                    label: 'Ubah perangkat',
                    disabled: busy !== null,
                    hidden: !canWrite,
                    onSelect: () => setForm(formFrom(device)),
                  },
                  {
                    key: 'delete',
                    label: 'Hapus perangkat',
                    tone: 'danger',
                    disabled: busy !== null,
                    hidden: !canDelete,
                    onSelect: () => remove(device),
                  },
                ]}
              />
            </td>
          </tr>
        ))}
      </Table>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4">
          <Card className="mt-10 w-full max-w-2xl">
            <h2 className="mb-1 text-lg font-semibold text-white">
              {form.id ? 'Ubah perangkat OLT' : 'Tambah perangkat OLT'}
            </h2>
            <p className="mb-4 text-xs text-slate-400">
              Kredensial disimpan terenkripsi dan tidak pernah ditampilkan kembali.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-300">
                Nama perangkat
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="OLT Muncang"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Driver (vendor)
                <select
                  value={form.vendor}
                  onChange={(event) => setForm({ ...form, vendor: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                >
                  {vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-300">
                Transport
                <select
                  value={form.transport}
                  onChange={(event) => {
                    const transport = event.target.value as 'ssh' | 'telnet';
                    setForm({
                      ...form,
                      transport,
                      port: transport === 'ssh' ? '22' : '23',
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="ssh">ssh</option>
                  <option value="telnet">telnet</option>
                </select>
              </label>

              <label className="text-xs text-slate-300">
                Port PON
                <input
                  value={form.pon_ports}
                  onChange={(event) => setForm({ ...form, pon_ports: event.target.value })}
                  placeholder="0/1 atau 0/1,0/2"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Host
                <input
                  value={form.host}
                  onChange={(event) => setForm({ ...form, host: event.target.value })}
                  placeholder="10.0.0.2 atau tunnel.example:3034"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Port
                <input
                  value={form.port}
                  onChange={(event) => setForm({ ...form, port: event.target.value })}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Username
                <input
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Password
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder={form.id ? 'kosongkan bila tidak diubah' : ''}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Password enable (opsional)
                <input
                  type="password"
                  value={form.enable_password}
                  onChange={(event) => setForm({ ...form, enable_password: event.target.value })}
                  placeholder="kosong = pakai password login"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>

              <label className="text-xs text-slate-300">
                Pola prompt (opsional)
                <input
                  value={form.prompt_pattern}
                  onChange={(event) => setForm({ ...form, prompt_pattern: event.target.value })}
                  placeholder="[A-Za-z0-9._-]+[>#]"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900"
              />
              Aktif (boleh dibaca saat sinkron)
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setForm(null)} disabled={busy === 'save'}>
                Batal
              </Button>
              <Button variant="primary" onClick={save} disabled={busy === 'save'}>
                {busy === 'save' ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {syslogDevice && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4">
          <Card className="mt-10 w-full max-w-2xl">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Syslog Client — {syslogDevice.name}
            </h2>
            <p className="mb-4 text-xs text-slate-400">
              vendor {syslogDevice.vendor} · kolektor internal Jawara-ISP (UDP/514)
            </p>

            {syslogNote && (
              <div
                className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                  syslogNote.kind === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                }`}
              >
                {syslogNote.text}
              </div>
            )}

            <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs">
              <p className="mb-1 font-medium text-slate-300">Status di perangkat (read-back)</p>
              {syslogBusy && !syslogState ? (
                <p className="text-slate-500">Membaca…</p>
              ) : syslogState ? (
                <>
                  <p className="text-slate-200">
                    Syslog:{' '}
                    <span className={syslogState.enabled ? 'text-emerald-300' : 'text-rose-300'}>
                      {syslogState.enabled ? 'aktif' : 'nonaktif'}
                    </span>
                    {syslogState.collectorIp
                      ? ` · tujuan ${syslogState.collectorIp}:${syslogState.collectorPort}`
                      : ''}
                  </p>
                  {syslogState.readBack && (
                    <p className="mt-1 truncate text-slate-500">{syslogState.readBack.slice(0, 140)}</p>
                  )}
                </>
              ) : (
                <p className="text-slate-500">Belum ada data. Klik Segarkan.</p>
              )}
            </div>

            {canWriteSyslog ? (
              <>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={syslogEnabled}
                    onChange={(event) => setSyslogEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                  Aktifkan Syslog Client
                </label>
                {syslogEnabled && (
                  <label className="mt-3 block text-xs text-slate-300">
                    IP kolektor internal
                    <input
                      value={syslogIp}
                      onChange={(event) => setSyslogIp(event.target.value)}
                      placeholder="192.168.76.254"
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100"
                    />
                  </label>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  {syslogDevice.vendor === 'vsol' || syslogDevice.vendor === 'global'
                    ? 'VSOL: menetapkan remote IP + mengaktifkan event/alarm ONU (bawaan).'
                    : 'HiFocus: hanya IP tujuan; port/protocol/severity tetap UDP/514.'}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-slate-500">
                Anda hanya dapat melihat status (mengubah hanya untuk admin).
              </p>
            )}

            {syslogResult && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs">
                <p className="font-medium text-slate-300">Hasil terapkan</p>
                <p className="text-slate-200">
                  sebelum: {syslogResult.before.enabled ? `aktif · ${syslogResult.before.collectorIp}` : 'nonaktif'}
                </p>
                <p className="text-slate-200">
                  sesudah: {syslogResult.after.enabled ? `aktif · ${syslogResult.after.collectorIp}` : 'nonaktif'}
                </p>
                <p className={syslogResult.verified ? 'text-emerald-300' : 'text-rose-300'}>
                  {syslogResult.verified
                    ? '✓ terverifikasi (read-back cocok)'
                    : '✗ read-back belum cocok — tinjau & rollback bila perlu'}
                </p>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => openSyslog(syslogDevice)} disabled={syslogBusy}>
                Segarkan
              </Button>
              {canWriteSyslog && (
                <>
                  <Button onClick={rollbackSyslog} disabled={syslogBusy}>
                    Rollback
                  </Button>
                  <Button variant="primary" onClick={applySyslog} disabled={syslogBusy}>
                    {syslogBusy ? 'Memproses…' : 'Terapkan'}
                  </Button>
                </>
              )}
              <Button onClick={() => setSyslogDevice(null)} disabled={syslogBusy}>
                Tutup
              </Button>
            </div>
          </Card>
        </div>
      )}

    </div>
  );
};

export default OltDevices;
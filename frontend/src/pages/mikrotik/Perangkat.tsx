import React, { useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  DeviceListPayload,
  ErrorNote,
  InfoNote,
  Loading,
  MikrotikDevice,
  PageHeader,
  StatCard,
  Table,
  Toolbar,
  errorMessage,
  useNet,
} from '../../components/net/NetUI';

interface FormState {
  id?: number;
  name: string;
  host: string;
  api_port: string;
  api_user: string;
  api_password: string;
  gui_url: string;
  description: string;
  write_enabled: boolean;
  is_active: boolean;
}

interface TestResult {
  id: number;
  name: string;
  host: string;
  port: number;
  connected: boolean;
  message: string;
  identity: string | null;
  version: string | null;
  board?: string | null;
  uptime?: string | null;
  latency_ms: number | null;
}

const emptyForm = (): FormState => ({
  name: '',
  host: '',
  api_port: '1998',
  api_user: '',
  api_password: '',
  gui_url: '',
  description: '',
  write_enabled: false,
  is_active: true,
});

const formFrom = (device: MikrotikDevice): FormState => ({
  id: device.id,
  name: device.name,
  host: device.host,
  api_port: String(device.api_port),
  api_user: device.api_user,
  api_password: '',
  gui_url: device.gui_url ?? '',
  description: device.description ?? '',
  write_enabled: device.write_enabled,
  is_active: device.is_active,
});

const formatMoment = (value: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

// Halaman daftar perangkat MikroTik: CRUD koneksi + uji koneksi API.
// Password hanya dikirim satu arah (server tidak pernah mengembalikannya).
const Perangkat: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const list = useNet<DeviceListPayload>('/api/mikrotik/devices');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<number, TestResult | 'loading'>>({});
  const [confirmDelete, setConfirmDelete] = useState<MikrotikDevice | null>(null);

  const rows = list.data?.rows ?? [];
  const ready = list.data?.ready ?? false;
  const migration = list.data?.migration ?? '005_mikrotik_devices.sql';
  const activeCount = rows.filter((row) => row.is_active).length;
  const connectedCount = rows.filter((row) => row.last_connected === true).length;
  const encryptionNote = rows.some((row) => row.password_set && !row.password_encrypted);

  const runTest = async (device: MikrotikDevice) => {
    setTests((current) => ({ ...current, [device.id]: 'loading' }));
    try {
      const response = await api.post<TestResult>(`/api/mikrotik/devices/${device.id}/test`);
      setTests((current) => ({ ...current, [device.id]: response.data }));
      list.reload();
    } catch (error) {
      setTests((current) => ({
        ...current,
        [device.id]: {
          id: device.id,
          name: device.name,
          host: device.host,
          port: device.api_port,
          connected: false,
          message: errorMessage(error),
          identity: null,
          version: null,
          latency_ms: null,
        },
      }));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        host: form.host.trim(),
        api_port: Number(form.api_port) || 1998,
        api_user: form.api_user.trim(),
        gui_url: form.gui_url.trim(),
        description: form.description.trim(),
        write_enabled: form.write_enabled,
        is_active: form.is_active,
      };
      // Hanya kirim password bila diisi: artinya "jangan ubah kredensial".
      if (form.api_password.trim() !== '') payload.api_password = form.api_password.trim();

      if (form.id) {
        await api.patch(`/api/mikrotik/devices/${form.id}`, payload);
        setNotice(`Perangkat "${form.name}" diperbarui.`);
      } else {
        await api.post('/api/mikrotik/devices', payload);
        setNotice(`Perangkat "${form.name}" ditambahkan.`);
      }
      setForm(null);
      list.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await api.delete(`/api/mikrotik/devices/${confirmDelete.id}`);
      setNotice(`Perangkat "${confirmDelete.name}" dihapus.`);
      setConfirmDelete(null);
      list.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Perangkat & Koneksi MikroTik"
        subtitle="Daftar router yang dikelola panel. Kredensial API disimpan di database dan dienkripsi (AES-256-GCM dengan kunci SECRET_KEY aplikasi); password tidak pernah dikirim kembali ke browser."
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={() => { setForm(emptyForm()); setFormError(null); }}>
              Tambah perangkat
            </Button>
          ) : (
            <Badge tone="mute">Hanya admin dapat mengubah</Badge>
          )
        }
      />

      {notice && <InfoNote>{notice}</InfoNote>}
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}

      {!ready && !list.loading && (
        <InfoNote tone="warn">
          Tabel <code>mikrotik_devices</code> belum ada di database. Jalankan migrasi{' '}
          <code>{migration}</code> (setelah backup) lalu muat ulang halaman ini. Tanpa tabel ini panel
          masih memakai konfigurasi tunggal di Pengaturan → Integrasi, sehingga belum bisa menyimpan
          lebih dari satu router.
        </InfoNote>
      )}

      {encryptionNote && (
        <InfoNote tone="warn">
          Ada perangkat dengan password tersimpan sebagai teks biasa (hasil seed migrasi). Buka
          perangkat tersebut, isi ulang password, lalu simpan agar tersimpan terenkripsi.
        </InfoNote>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total perangkat" value={list.loading ? '-' : rows.length} />
        <StatCard label="Aktif" value={list.loading ? '-' : activeCount} />
        <StatCard
          label="Terhubung terakhir"
          value={list.loading ? '-' : connectedCount}
          tone={connectedCount > 0 ? 'good' : 'default'}
        />
        <StatCard
          label="Password kosong"
          value={list.loading ? '-' : rows.filter((row) => !row.password_set).length}
          tone={rows.some((row) => !row.password_set) ? 'warn' : 'default'}
          hint="Isi password agar API bisa dipakai"
        />
      </div>

      <Card>
        <Toolbar>
          <span className="text-sm text-slate-400">Kredensial disimpan per perangkat, bukan di file konfigurasi.</span>
          <Button onClick={list.reload} className="ml-auto">
            Muat ulang
          </Button>
        </Toolbar>

        {list.loading && rows.length === 0 ? (
          <Loading label="Memuat daftar perangkat..." />
        ) : (
          <div className="mt-3">
            <Table
              columns={['Perangkat', 'Alamat API', 'User', 'Password', 'Mode tulis', 'Status terakhir', 'Aksi']}
              isEmpty={rows.length === 0}
              empty="Belum ada perangkat. Tambahkan router pertama Anda."
            >
              {rows.map((device) => {
                const test = tests[device.id];
                const result = test && test !== 'loading' ? test : null;
                return (
                  <tr key={device.id} className="align-top">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{device.name}</span>
                        {device.is_active ? (
                          <Badge tone="good">aktif</Badge>
                        ) : (
                          <Badge tone="mute">nonaktif</Badge>
                        )}
                      </div>
                      {device.description && (
                        <p className="mt-1 text-xs text-slate-500">{device.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">
                      {device.host}:{device.api_port}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">{device.api_user}</td>
                    <td className="px-3 py-2">
                      {device.password_set ? (
                        <Badge tone={device.password_encrypted ? 'good' : 'warn'}>
                          {device.password_encrypted ? 'terenkripsi' : 'teks biasa'}
                        </Badge>
                      ) : (
                        <Badge tone="bad">belum diisi</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {device.write_enabled ? (
                        <Badge tone="warn">boleh tulis</Badge>
                      ) : (
                        <Badge tone="mute">baca saja</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        {device.last_connected === true && <Badge tone="good">terhubung</Badge>}
                        {device.last_connected === false && <Badge tone="bad">gagal</Badge>}
                        {device.last_connected === null && <Badge tone="mute">belum diuji</Badge>}
                        <span className="text-slate-500">{formatMoment(device.last_checked_at)}</span>
                      </div>
                      {device.last_message && (
                        <p className="mt-1 max-w-xs truncate text-slate-500" title={device.last_message}>
                          {device.last_message}
                        </p>
                      )}
                      {result && (
                        <p className={`mt-1 ${result.connected ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {result.connected
                            ? `${result.identity ?? '-'} · ${result.version ?? '-'} · ${result.latency_ms ?? '-'} ms`
                            : result.message}
                        </p>
                      )}
                      {test === 'loading' && <p className="mt-1 text-slate-400">Menghubungi router...</p>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => runTest(device)} disabled={test === 'loading'}>
                          Uji
                        </Button>
                        {device.gui_url && (
                          <a
                            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                            href={device.gui_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            WebFig
                          </a>
                        )}
                        {isAdmin && (
                          <>
                            <Button onClick={() => { setForm(formFrom(device)); setFormError(null); }}>
                              Ubah
                            </Button>
                            <Button variant="danger" onClick={() => setConfirmDelete(device)}>
                              Hapus
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}
      </Card>

      <InfoNote>
        Catatan keamanan: kredensial dienkripsi sebelum masuk database. Bila <code>SECRET_KEY</code> di
        backend diganti, password tersimpan tidak bisa dibaca lagi dan harus diisi ulang. Mode tulis
        (hotspot/PPP/interface) hanya aktif bila tombol &quot;izinkan tulis&quot; pada perangkat diaktifkan
        dan role Anda admin.
      </InfoNote>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={submit} className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {form.id ? `Ubah perangkat: ${form.name}` : 'Tambah perangkat MikroTik'}
            </h2>

            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-slate-300">Nama perangkat</span>
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  placeholder="Contoh: Nanggela / Cabang Sukamaju"
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 block text-sm">
                  <span className="text-slate-300">Host / IP API</span>
                  <input
                    required
                    value={form.host}
                    onChange={(event) => setForm({ ...form, host: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-slate-100"
                    placeholder="192.168.100.254"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Port API</span>
                  <input
                    required
                    value={form.api_port}
                    onChange={(event) => setForm({ ...form, api_port: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-slate-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">User API</span>
                  <input
                    required
                    value={form.api_user}
                    onChange={(event) => setForm({ ...form, api_user: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-slate-100"
                    placeholder="hermes"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">
                    Password API{' '}
                    {form.id && <span className="text-xs text-slate-500">(kosongkan bila tidak diubah)</span>}
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.api_password}
                    onChange={(event) => setForm({ ...form, api_password: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                    placeholder={form.id ? '••••••••' : 'password user API'}
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-slate-300">URL WebFig (opsional)</span>
                <input
                  value={form.gui_url}
                  onChange={(event) => setForm({ ...form, gui_url: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  placeholder="http://192.168.100.254"
                />
              </label>

              <label className="block text-sm">
                <span className="text-slate-300">Keterangan (opsional)</span>
                <input
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  placeholder="Lokasi / fungsi router"
                />
              </label>

              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.write_enabled}
                  onChange={(event) => setForm({ ...form, write_enabled: event.target.checked })}
                  className="mt-1"
                />
                <span>
                  Izinkan tulis ke router ini (hotspot/PPP/interface)
                  <span className="mt-1 block text-xs text-slate-500">
                    Biarkan mati saat masih uji coba. Tindakan tulis selalu dicatat di audit log.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                  className="mt-1"
                />
                <span>
                  Perangkat aktif
                  <span className="mt-1 block text-xs text-slate-500">
                    Hanya perangkat aktif yang bisa dipilih pada halaman hotspot/PPP/routing.
                  </span>
                </span>
              </label>
            </div>

            {formError && <div className="mt-3"><ErrorNote message={formError} /></div>}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setForm(null)} disabled={saving}>
                Batal
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Hapus perangkat?</h2>
            <p className="mt-2 text-sm text-slate-300">
              Perangkat <span className="font-semibold">{confirmDelete.name}</span> (
              {confirmDelete.host}:{confirmDelete.api_port}) akan dihapus beserta kredensialnya. Data
              pelanggan, paket, dan tagihan tidak terpengaruh.
            </p>
            {formError && <div className="mt-3"><ErrorNote message={formError} /></div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirmDelete(null)} disabled={saving}>
                Batal
              </Button>
              <Button variant="danger" onClick={remove} disabled={saving}>
                {saving ? 'Menghapus...' : 'Hapus perangkat'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Perangkat;
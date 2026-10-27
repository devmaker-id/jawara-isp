import React, { useCallback, useEffect, useState, useRef } from 'react';
import api from '../../services/api';
import { useBackgroundRefresh } from '../../hooks/useBackgroundRefresh';
import { useAuth } from '../../contexts/AuthContext';
import OwnerSelect from '../../components/OwnerSelect';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  Table,
  errorMessage,
} from '../../components/net/NetUI';

// Group Profile: satu grup = satu router. Nama grup dipakai sebagai nama profil
// di MikroTik dan sebagai nama grup RADIUS, sehingga tidak perlu dua penamaan.

/** Hasil penyiapan profil lokal di perangkat. */
interface Provisioning {
  ok: boolean;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  device: string;
  message: string;
  command: string;
}

interface GroupRow {
  id: number;
  name: string;
  owner_id?: number | null;
  owner_name?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  type: 'hotspot' | 'ppp';
  router_id: number;
  pool_mode: 'mikrotik-pool' | 'sql-ippool' | 'group-pool' | 'router-pool';
  mikrotik_pool_name: string | null;
  pool_local_address: string | null;
  pool_range_start: string | null;
  pool_range_end: string | null;
  dns_primary: string | null;
  dns_secondary: string | null;
  parent_queue: string | null;
  use_router_default: number;
}

interface Device {
  id: number;
  name: string;
  host: string;
}

interface FormState {
  name: string;
  /** Pemilik data (admin saja). '' = dirinya sendiri. */
  owner_id: string;
  type: 'hotspot' | 'ppp';
  router_id: string;
  pool_mode: 'mikrotik-pool' | 'sql-ippool' | 'group-pool' | 'router-pool';
  mikrotik_pool_name: string;
  pool_local_address: string;
  pool_range_start: string;
  pool_range_end: string;
  dns_primary: string;
  dns_secondary: string;
  parent_queue: string;
  use_router_default: boolean;
}

/** Penanda objek buatan panel di router — harus sama dengan OWNER_COMMENT di backend. */
const OWNER_COMMENT = 'created by jawara-isp';

/** Nama pool yang akan dibuat panel; cermin dari poolNameFor() di backend. */
const poolNameFor = (name: string) => {
  const slug = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `jw-${slug || 'pool'}`.slice(0, 64);
};

const EMPTY: FormState = {
  name: '',
  owner_id: '',
  type: 'hotspot',
  router_id: '',
  pool_mode: 'group-pool',
  mikrotik_pool_name: '',
  pool_local_address: '',
  pool_range_start: '',
  pool_range_end: '',
  dns_primary: '8.8.8.8',
  dns_secondary: '1.1.1.1',
  parent_queue: '',
  use_router_default: false,
};

const GroupProfile: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [rows, setRows] = useState<GroupRow[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<Provisioning | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<GroupRow | null>(null);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const [groups, deviceList] = await Promise.all([
        api.get<GroupRow[]>('/api/profiles/groups'),
        // Endpoint perangkat membungkus daftar dalam { ready, rows }.
        api.get<{ rows: Device[] }>('/api/mikrotik/devices'),
      ]);
      setRows(groups.data);
      setDevices(deviceList.data.rows ?? []);
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

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY, router_id: devices[0] ? String(devices[0].id) : '' });
  };

  const openEdit = (row: GroupRow) => {
    setEditId(row.id);
    setForm({
      ...EMPTY,
      name: row.name,
      owner_id: row.owner_id ? String(row.owner_id) : '',
      type: row.type,
      router_id: String(row.router_id),
      pool_mode: row.pool_mode,
      mikrotik_pool_name: row.mikrotik_pool_name ?? '',
      pool_local_address: row.pool_local_address ?? '',
      pool_range_start: row.pool_range_start ?? '',
      pool_range_end: row.pool_range_end ?? '',
      dns_primary: row.dns_primary ?? '',
      dns_secondary: row.dns_secondary ?? '',
      parent_queue: row.parent_queue ?? '',
      use_router_default: row.use_router_default === 1,
    });
  };

  // Nama pool yang akan dibuat panel, ditampilkan sebagai pratinjau.
  const poolPreview = form ? `"${poolNameFor(form.name)}"` : '';

  const invalid =
    !form ||
    form.name.trim() === '' ||
    form.router_id === '' ||
    (!form.use_router_default && form.pool_mode === 'mikrotik-pool' && form.mikrotik_pool_name.trim() === '') ||
    (!form.use_router_default &&
      form.pool_mode === 'router-pool' &&
      (form.pool_range_start.trim() === '' ||
        form.pool_range_end.trim() === '' ||
        form.pool_local_address.trim() === ''));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      router_id: Number(form.router_id),
      pool_mode: form.pool_mode,
      mikrotik_pool_name: form.pool_mode === 'mikrotik-pool' ? form.mikrotik_pool_name.trim() : null,
      pool_local_address: form.pool_mode === 'router-pool' ? form.pool_local_address.trim() || null : null,
      pool_range_start: form.pool_mode === 'router-pool' ? form.pool_range_start.trim() || null : null,
      pool_range_end: form.pool_mode === 'router-pool' ? form.pool_range_end.trim() || null : null,
      dns_primary: form.dns_primary.trim() || null,
      dns_secondary: form.dns_secondary.trim() || null,
      parent_queue: form.parent_queue.trim() || null,
      use_router_default: form.use_router_default,
    };
    try {
      const { data } = editId
        ? await api.patch<{ provisioning?: Provisioning }>(`/api/profiles/groups/${editId}`, payload)
        : await api.post<{ provisioning?: Provisioning }>('/api/profiles/groups', {
            ...payload,
            ...(form.owner_id === 'none'
              ? { owner_id: null }
              : form.owner_id !== ''
                ? { owner_id: Number(form.owner_id) }
                : {}),
          });
      const prov = data?.provisioning;
      if (prov) {
        // Hasil penyiapan di perangkat dilaporkan apa adanya: berhasil, ditolak,
        // atau belum bisa karena tulis ke perangkat dimatikan.
        setProvisioning(prov);
        setToast(editId ? 'Group Profile diperbarui.' : 'Group Profile dibuat.');
      } else {
        setToast(editId ? 'Group Profile diperbarui.' : 'Group Profile dibuat.');
      }
      setForm(null);
      setEditId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await api.delete(`/api/profiles/groups/${confirm.id}`);
      setToast('Group Profile dihapus.');
      setConfirm(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deviceName = (id: number) => devices.find((d) => d.id === id)?.name ?? `#${id}`;

  return (
    <div className="page-container">
      <PageHeader
        title="Profile Group — Group Profile"
        subtitle="Satu grup menempel pada satu router. Nama grup dipakai sebagai nama profil di MikroTik dan nama grup RADIUS."
        actions={isAdmin ? <Button variant="primary" onClick={openCreate}>Tambah grup</Button> : undefined}
      />

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{toast}</div>
      )}

      {provisioning && (
        <div className="mb-3">
          <Card>
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className={`text-sm font-semibold ${provisioning.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                Profil perangkat: {provisioning.action} · {provisioning.device}
              </p>
              <button
                type="button"
                className="text-xs text-slate-400 hover:underline"
                onClick={() => setProvisioning(null)}
              >
                tutup
              </button>
            </div>
            <p className="text-xs text-slate-300">{provisioning.message}</p>
            {!provisioning.ok && provisioning.command && (
              <>
                <p className="mt-2 text-xs text-slate-400">Jalankan manual di terminal MikroTik:</p>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-900/70 p-2 text-xs text-cyan-200">
                  {provisioning.command}
                </pre>
              </>
            )}
          </Card>
        </div>
      )}
      {error && <div className="mb-3"><ErrorNote message={error} onRetry={() => void load()} /></div>}

      <Card>
        {loading ? (
          <Loading label="Memuat group profile…" />
        ) : (
          <Table
            columns={['Nama', 'Tipe', 'Router', 'Pool', 'DNS', 'Parent Queue', 'Pemilik', 'Dibuat oleh', isAdmin ? 'Aksi' : '']}
            isEmpty={rows.length === 0}
            empty="Belum ada group profile."
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                <td className="px-3 py-2">
                  <Badge tone={row.type === 'hotspot' ? 'good' : 'warn'}>{row.type}</Badge>
                </td>
                <td className="px-3 py-2 text-xs">{deviceName(row.router_id)}</td>
                <td className="px-3 py-2 text-xs">
                  {row.pool_mode === 'sql-ippool' ? (
                    <Badge tone="mute">sql-ippool</Badge>
                  ) : (
                    <div>
                      <span className="font-mono text-[11px]">
                        {row.pool_mode === 'group-pool' ? 'bawaan router' : row.mikrotik_pool_name}
                      </span>
                      {row.pool_mode === 'router-pool' && (
                        <p className="font-mono text-[10px] text-slate-500">
                          {row.pool_range_start}-{row.pool_range_end}
                          {row.pool_local_address ? ` · gw ${row.pool_local_address}` : ''}
                        </p>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                  {row.dns_primary ?? '-'}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                  {row.parent_queue ?? '-'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">
                  {row.owner_name ?? <span className="text-slate-500">Tanpa pemilik</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{row.created_by_name ?? '—'}</td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button onClick={() => openEdit(row)} disabled={busy}>Edit</Button>
                      <Button variant="danger" onClick={() => setConfirm(row)} disabled={busy}>Hapus</Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {form && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 sm:rounded-2xl">
            <h3 className="text-base font-semibold text-slate-100">
              {editId ? 'Ubah group profile' : 'Tambah group profile'}
            </h3>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Nama grup *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  placeholder="HS-RUMAHAN" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Nama ini juga menjadi nama profil di MikroTik. Tidak boleh kembar dalam satu tipe.
                </p>
              </div>

              {!editId && (
                <OwnerSelect
                  value={form.owner_id}
                  onChange={(value) => setForm((f) => (f ? { ...f, owner_id: value } : f))}
                  label="Pemilik grup (admin boleh membuat atas nama akun lain)"
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Tipe *</label>
                  <select value={form.type} onChange={(e) => setForm({
                    ...form,
                    type: e.target.value as 'hotspot' | 'ppp',
                    // Mode awal mengikuti tipe: group-pool khusus hotspot,
                    // router-pool khusus PPP. Isian pool lama dibuang.
                    pool_mode: e.target.value === 'hotspot' ? 'group-pool' : 'router-pool',
                    mikrotik_pool_name: '',
                    pool_local_address: '',
                  })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                    <option value="hotspot">HOTSPOT</option>
                    <option value="ppp">PPP</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Router *</label>
                  <select value={form.router_id} onChange={(e) => setForm({ ...form, router_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                    <option value="">Pilih router…</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>{device.name} ({device.host})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Modul IP pool</label>
                <select value={form.pool_mode}
                  onChange={(e) => setForm({ ...form, pool_mode: e.target.value as FormState['pool_mode'] })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                  {form.type === 'hotspot' ? (
                    <>
                      <option value="group-pool">GROUP ONLY (Hotspot Only)</option>
                      <option value="mikrotik-pool">Pakai IP pool yang sudah ada di router</option>
                      <option value="sql-ippool">SQL-IP-POOL RADIUS (global)</option>
                    </>
                  ) : (
                    <>
                      <option value="router-pool">IP pool MikroTik (per router)</option>
                      <option value="mikrotik-pool">Pakai IP pool yang sudah ada di router</option>
                      <option value="sql-ippool">SQL-IP-POOL RADIUS (global)</option>
                    </>
                  )}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {form.pool_mode === 'group-pool'
                    ? 'RADIUS memakai profil hotspot bawaan router. Tidak ada IP pool maupun profil hotspot yang ditulis ke MikroTik.'
                    : form.pool_mode === 'router-pool'
                      ? `Panel membuat pool ${poolPreview} di router (komentar "${OWNER_COMMENT}") lalu profil PPP yang menunjuknya.`
                      : form.pool_mode === 'mikrotik-pool'
                        ? 'Pool tidak dibuat panel — pilih pool yang sudah ada di router.'
                        : 'Alamat diberikan RADIUS; tidak ada pool di router.'}
                </p>
              </div>

              {form.pool_mode === 'mikrotik-pool' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Nama IP pool di router *</label>
                  <input value={form.mikrotik_pool_name}
                    onChange={(e) => setForm({ ...form, mikrotik_pool_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                    placeholder="hs-nanggela" />
                </div>
              )}

              {form.pool_mode === 'router-pool' && (
                <>
                  {(
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">IP local (gateway sesi) *</label>
                      <input value={form.pool_local_address}
                        onChange={(e) => setForm({ ...form, pool_local_address: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="172.10.0.1" />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Ditulis sebagai <code>local-address</code> pada profil PPP. Tidak boleh masuk ke rentang pool.
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">IP awal pool *</label>
                      <input value={form.pool_range_start}
                        onChange={(e) => setForm({ ...form, pool_range_start: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="172.10.0.2" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">IP akhir pool *</label>
                      <input value={form.pool_range_end}
                        onChange={(e) => setForm({ ...form, pool_range_end: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="172.10.0.254" />
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">DNS utama</label>
                  <input value={form.dns_primary} onChange={(e) => setForm({ ...form, dns_primary: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                    placeholder="8.8.8.8" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">DNS kedua</label>
                  <input value={form.dns_secondary} onChange={(e) => setForm({ ...form, dns_secondary: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                    placeholder="1.1.1.1" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Parent queue</label>
                <input value={form.parent_queue} onChange={(e) => setForm({ ...form, parent_queue: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                  placeholder="B. 10 Mbps Up To" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Ditulis manual, harus sama dengan nama parent queue di MikroTik.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-200">
                <input type="checkbox" className="mt-1" checked={form.use_router_default}
                  onChange={(e) => setForm({ ...form, use_router_default: e.target.checked })} />
                <span>
                  Pakai profil bawaan router
                  <span className="block text-xs text-slate-400">
                    Bila dicentang, panel tidak membuat profil baru; router memakai profil default-nya.
                  </span>
                </span>
              </label>
            </div>

            {invalid && (
              <p className="mt-2 text-xs text-amber-300">
                Nama, router, dan nama IP pool (bila memakai pool MikroTik) wajib diisi.
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setForm(null)}>Batal</Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy || invalid}>
                {busy ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-slate-100">Hapus group profile?</h3>
            <p className="mt-2 text-sm text-slate-300">
              <span className="font-mono">{confirm.name}</span> akan dihapus. Grup yang masih dipakai
              profil atau voucher tidak bisa dihapus.
            </p>
            <p className="mt-2 text-xs text-amber-400">
              Objek di perangkat TIDAK ikut terhapus. Hapus manual bila memang tidak dipakai lagi:
            </p>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-900/70 p-2 text-[11px] text-cyan-200">
              {[
                `${confirm.type === 'hotspot' ? '/ip/hotspot/user/profile' : '/ppp/profile'} remove [find name="${confirm.name}"]`,
                confirm.pool_mode === 'router-pool' && confirm.mikrotik_pool_name
                  ? `/ip/pool remove [find name="${confirm.mikrotik_pool_name}"]`
                  : `/ip/pool print where comment="${OWNER_COMMENT}"`,
              ].join('\n')}
            </pre>
            <p className="mt-1 text-[11px] text-slate-500">
              Pool buatan panel ditandai komentar <code>{OWNER_COMMENT}</code>.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirm(null)}>Batal</Button>
              <Button variant="danger" onClick={() => void remove()} disabled={busy}>Hapus</Button>
            </div>
          </div>
        </div>
      )}

      {devices.length === 0 && !loading && (
        <div className="mt-4">
          <InfoNote tone="warn">
            Belum ada perangkat MikroTik terdaftar. Tambahkan di menu MikroTik → Perangkat
            sebelum membuat Group Profile.
          </InfoNote>
        </div>
      )}
    </div>
  );
};

export default GroupProfile;

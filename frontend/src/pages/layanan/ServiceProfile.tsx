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
  Loading,
  PageHeader,
  Table,
  errorMessage,
} from '../../components/net/NetUI';

// Profil Hotspot / PPP — satu komponen untuk dua tipe karena aturannya hampir
// sama. Perbedaan: PPP tidak punya quota base, dan shared > 1 ditolak bila
// Group Profile memakai SQL-IP-POOL (ditegakkan backend).

export type ProfileType = 'hotspot' | 'ppp';

interface ProfileRow {
  id: number;
  name: string;
  owner_id?: number | null;
  owner_name?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  group_profile_id: number;
  bandwidth_id: number;
  cost_price: number;
  sell_price: number;
  promo_price: number;
  tax_percent: number;
  quota_type?: 'unlimited' | 'limited';
  time_limit_seconds?: number | null;
  quota_limit_bytes?: number | null;
  timebase_value?: number | null;
  timebase_unit?: string | null;
  quotabase_value?: number | null;
  quotabase_unit?: string | null;
  validity_value: number;
  validity_unit: string;
  shared_users: number;
  priority: number;
  login_days: string | null;
  login_start: string | null;
  login_end: string | null;
  is_active: number;
}

interface GroupOption {
  id: number;
  name: string;
  type: ProfileType;
  router_id: number;
  pool_mode: 'mikrotik-pool' | 'sql-ippool' | 'group-pool' | 'router-pool';
  mikrotik_pool_name: string | null;
  pool_range_start: string | null;
  pool_range_end: string | null;
  pool_local_address: string | null;
  parent_queue: string | null;
  dns_primary: string | null;
  dns_secondary: string | null;
  use_router_default: number;
}

interface BandwidthOption {
  id: number;
  name: string;
  max_upload_kbps: number;
  max_download_kbps: number;
}

interface Preview {
  groupname: string;
  radius: { reply: Array<{ attribute: string; value: string }>; check: Array<{ attribute: string; value: string }> };
  writes_to_router: boolean;
  group: {
    name: string;
    type: ProfileType;
    router_id: number;
    pool_mode: string;
    pool_name: string | null;
    pool_range: string | null;
    parent_queue: string | null;
    dns: string;
    local_profile: string | null;
  };
  price: { base: number; tax: number; total: number };
  validity_seconds: number | null;
}

/** Ringkasan sumber IP dari sebuah grup, untuk ditampilkan apa adanya. */
const groupPool = (group: GroupOption) => {
  if (group.pool_mode === 'sql-ippool') return 'sql-ippool (RADIUS)';
  // GROUP ONLY tidak punya pool: alamat datang dari profil hotspot bawaan.
  if (group.pool_mode === 'group-pool') return 'profil hotspot bawaan router';
  if (group.pool_mode === 'router-pool') {
    return `${group.mikrotik_pool_name}${group.pool_range_start ? ` ${group.pool_range_start}-${group.pool_range_end}` : ''}`;
  }
  return group.mikrotik_pool_name ?? '-';
};

const UNITS = [
  { value: 'minute', label: 'Menit' },
  { value: 'hour', label: 'Jam' },
  { value: 'day', label: 'Hari' },
  { value: 'month', label: 'Bulan' },
];
const DAYS = [
  { value: 'mon', label: 'Sen' },
  { value: 'tue', label: 'Sel' },
  { value: 'wed', label: 'Rab' },
  { value: 'thu', label: 'Kam' },
  { value: 'fri', label: 'Jum' },
  { value: 'sat', label: 'Sab' },
  { value: 'sun', label: 'Min' },
];

interface FormState {
  name: string;
  /** Pemilik data (admin saja). '' = dirinya sendiri. */
  owner_id: string;
  group_profile_id: string;
  bandwidth_id: string;
  cost_price: string;
  sell_price: string;
  promo_price: string;
  tax_percent: string;
  quota_type: 'unlimited' | 'limited';
  time_limit_value: string;
  time_limit_unit: 'minute' | 'hour' | 'day';
  quota_limit_value: string;
  quota_limit_unit: 'MB' | 'GB';
  timebase_value: string;
  timebase_unit: string;
  quotabase_value: string;
  quotabase_unit: string;
  validity_value: string;
  validity_unit: string;
  shared_users: string;
  priority: string;
  login_days: string[];
  login_start: string;
  login_end: string;
}

const EMPTY: FormState = {
  name: '',
  owner_id: '',
  group_profile_id: '',
  bandwidth_id: '',
  cost_price: '',
  sell_price: '',
  promo_price: '0',
  tax_percent: '0',
  quota_type: 'unlimited',
  time_limit_value: '',
  time_limit_unit: 'hour',
  quota_limit_value: '',
  quota_limit_unit: 'GB',
  timebase_value: '',
  timebase_unit: 'hour',
  quotabase_value: '',
  quotabase_unit: 'GB',
  validity_value: '0',
  validity_unit: 'day',
  shared_users: '1',
  priority: '1',
  login_days: [],
  login_start: '',
  login_end: '',
};

const ServiceProfile: React.FC<{ type: ProfileType }> = ({ type }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isHotspot = type === 'hotspot';

  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [bandwidths, setBandwidths] = useState<BandwidthOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ProfileRow | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const [list, groupList, bwList] = await Promise.all([
        api.get<ProfileRow[]>(`/api/profiles/${type}`),
        api.get<GroupOption[]>('/api/profiles/groups', { params: { type } }),
        api.get<BandwidthOption[]>('/api/profiles/bandwidth'),
      ]);
      setRows(list.data);
      setGroups(groupList.data);
      setBandwidths(bwList.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  const openCreate = () => {
    setEditId(null);
    setForm({
      ...EMPTY,
      group_profile_id: groups[0] ? String(groups[0].id) : '',
      bandwidth_id: bandwidths[0] ? String(bandwidths[0].id) : '',
    });
  };

  const openEdit = (row: ProfileRow) => {
    setEditId(row.id);
    setForm({
      ...EMPTY,
      name: row.name,
      owner_id: row.owner_id ? String(row.owner_id) : '',
      group_profile_id: String(row.group_profile_id),
      bandwidth_id: String(row.bandwidth_id),
      cost_price: String(row.cost_price),
      sell_price: String(row.sell_price),
      promo_price: String(row.promo_price),
      tax_percent: String(row.tax_percent),
      quota_type: row.quota_type ?? 'unlimited',
      // Limitasi grup PPP disimpan dalam detik/byte; tampilkan dalam satuan besar.
      time_limit_value: row.time_limit_seconds
        ? String(row.time_limit_seconds % 3600 === 0 ? row.time_limit_seconds / 3600 : Math.round(row.time_limit_seconds / 60))
        : '',
      time_limit_unit: row.time_limit_seconds && row.time_limit_seconds % 3600 !== 0 ? 'minute' : 'hour',
      quota_limit_value: row.quota_limit_bytes
        ? String(row.quota_limit_bytes % 1_000_000_000 === 0 ? row.quota_limit_bytes / 1_000_000_000 : Math.round(row.quota_limit_bytes / 1_000_000))
        : '',
      quota_limit_unit: row.quota_limit_bytes && row.quota_limit_bytes % 1_000_000_000 !== 0 ? 'MB' : 'GB',
      timebase_value: row.timebase_value ? String(row.timebase_value) : '',
      timebase_unit: row.timebase_unit ?? 'hour',
      quotabase_value: row.quotabase_value ? String(row.quotabase_value) : '',
      quotabase_unit: row.quotabase_unit ?? 'GB',
      validity_value: String(row.validity_value),
      validity_unit: row.validity_unit,
      shared_users: String(row.shared_users),
      priority: String(row.priority),
      login_days: row.login_days ? row.login_days.split(',') : [],
      login_start: (row.login_start ?? '').slice(0, 5),
      login_end: (row.login_end ?? '').slice(0, 5),
    });
  };

  const selectedGroup = groups.find((g) => String(g.id) === form?.group_profile_id);

  const invalid =
    !form ||
    form.name.trim() === '' ||
    form.group_profile_id === '' ||
    form.bandwidth_id === '' ||
    Number(form.sell_price) < 0 ||
    Number(form.cost_price) < 0 ||
    Number(form.promo_price) > Number(form.sell_price) ||
    (isHotspot &&
      form.quota_type === 'limited' &&
      form.timebase_value === '' &&
      form.quotabase_value === '') ||
    (isHotspot && form.quota_type === 'limited' && Number(form.shared_users) > 1) ||
    (!isHotspot && selectedGroup?.pool_mode === 'sql-ippool' && Number(form.shared_users) > 1) ||
    ((form.login_start === '') !== (form.login_end === ''));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      group_profile_id: Number(form.group_profile_id),
      bandwidth_id: Number(form.bandwidth_id),
      cost_price: Number(form.cost_price),
      sell_price: Number(form.sell_price),
      promo_price: Number(form.promo_price || 0),
      tax_percent: Number(form.tax_percent || 0),
      validity_value: Number(form.validity_value || 0),
      validity_unit: form.validity_unit,
      shared_users: Number(form.shared_users || 1),
      priority: Number(form.priority || 1),
      login_days: form.login_days.length > 0 ? form.login_days : null,
      login_start: form.login_start || null,
      login_end: form.login_end || null,
    };
    if (!isHotspot) {
      // Limitasi grup PPP: ditulis ke radgroupreply, berlaku untuk semua user.
      payload.time_limit_value = form.time_limit_value ? Number(form.time_limit_value) : 0;
      payload.time_limit_unit = form.time_limit_unit;
      payload.quota_limit_value = form.quota_limit_value ? Number(form.quota_limit_value) : 0;
      payload.quota_limit_unit = form.quota_limit_unit;
    }
    if (isHotspot) {
      payload.quota_type = form.quota_type;
      if (form.quota_type === 'limited') {
        payload.timebase_value = form.timebase_value ? Number(form.timebase_value) : null;
        payload.timebase_unit = form.timebase_value ? form.timebase_unit : null;
        payload.quotabase_value = form.quotabase_value ? Number(form.quotabase_value) : null;
        payload.quotabase_unit = form.quotabase_value ? form.quotabase_unit : null;
      }
    }
    // Pemilik hanya ditetapkan saat MEMBUAT. Mengubahnya lewat sini akan
    // memindahkan data antar akun tanpa jejak audit.
    if (!editId) {
      if (form.owner_id === 'none') payload.owner_id = null;
      else if (form.owner_id !== '') payload.owner_id = Number(form.owner_id);
    }

    try {
      if (editId) await api.patch(`/api/profiles/${type}/${editId}`, payload);
      else await api.post(`/api/profiles/${type}`, payload);
      setToast(editId ? 'Profil diperbarui.' : 'Profil dibuat.');
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
      await api.delete(`/api/profiles/${type}/${confirm.id}`);
      setToast('Profil dihapus.');
      setConfirm(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async (row: ProfileRow) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.get<Preview>(`/api/profiles/${type}/${row.id}/preview`);
      setPreview(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;
  const bwName = (id: number) => bandwidths.find((b) => b.id === id)?.name ?? `#${id}`;
  // Angka limitasi yang benar-benar dikirim sebagai Mikrotik-Rate-Limit.
  const bwRate = (id: number) => {
    const bw = bandwidths.find((b) => b.id === id);
    return bw ? `${bw.max_upload_kbps}/${bw.max_download_kbps} kbps` : '';
  };
  const rupiah = (value: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

  return (
    <div className="page-container">
      <PageHeader
        title={`Profile Group — Profil ${isHotspot ? 'Hotspot' : 'PPP'}`}
        subtitle={
          (isHotspot
            ? 'Paket jual hotspot: harga, batas waktu/kuota, group profile, dan bandwidth.'
            : 'Paket jual PPP: harga, masa aktif, group profile, dan bandwidth. Tanpa quota base.') +
          ' Tidak menulis ke MikroTik — semuanya atribut RADIUS.'
        }
        actions={isAdmin ? <Button variant="primary" onClick={openCreate}>Tambah profil</Button> : undefined}
      />

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{toast}</div>
      )}
      {error && <div className="mb-3"><ErrorNote message={error} onRetry={() => void load()} /></div>}

      <Card>
        {loading ? (
          <Loading label="Memuat profil…" />
        ) : (
          <Table
            columns={[
              'Nama',
              'Group',
              'Bandwidth',
              'Harga jual',
              'PPN',
              'Masa aktif',
              isHotspot ? 'Kuota' : 'Shared',
              'Pemilik',
              'Dibuat oleh',
              isAdmin ? 'Aksi' : '',
            ]}
            isEmpty={rows.length === 0}
            empty={`Belum ada profil ${type}.`}
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                <td className="px-3 py-2 text-xs">{groupName(row.group_profile_id)}</td>
                <td className="px-3 py-2 text-xs">
                  {bwName(row.bandwidth_id)}
                  <span className="block font-mono text-[10px] text-slate-500">{bwRate(row.bandwidth_id)}</span>
                </td>
                <td className="px-3 py-2 text-xs">{rupiah(Number(row.sell_price))}</td>
                <td className="px-3 py-2 text-xs">{Number(row.tax_percent)}%</td>
                <td className="px-3 py-2 text-xs">
                  {Number(row.validity_value) === 0
                    ? 'tanpa batas'
                    : `${row.validity_value} ${row.validity_unit}`}
                </td>
                <td className="px-3 py-2 text-xs">
                  {isHotspot ? (
                    row.quota_type === 'limited' ? (
                      <Badge tone="warn">
                        {row.timebase_value ? `${row.timebase_value} ${row.timebase_unit}` : ''}
                        {row.timebase_value && row.quotabase_value ? ' / ' : ''}
                        {row.quotabase_value ? `${row.quotabase_value} ${row.quotabase_unit}` : ''}
                      </Badge>
                    ) : (
                      <Badge tone="good">unlimited</Badge>
                    )
                  ) : (
                    row.shared_users
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">
                  {row.owner_name ?? <span className="text-slate-500">Tanpa pemilik</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{row.created_by_name ?? '—'}</td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button onClick={() => void showPreview(row)} disabled={busy}>Pratinjau</Button>
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
          <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 sm:rounded-2xl">
            <h3 className="text-base font-semibold text-slate-100">
              {editId ? 'Ubah profil' : 'Tambah profil'} {type}
            </h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-400">Nama profil *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  placeholder="HS-10M-30HARI" />
              </div>

              {!editId && (
                <OwnerSelect
                  value={form.owner_id}
                  onChange={(value) => setForm((f) => (f ? { ...f, owner_id: value } : f))}
                  label="Pemilik profil (admin boleh membuat atas nama akun lain)"
                />
              )}

              <div>
                <label className="mb-1 block text-xs text-slate-400">Group Profile *</label>
                <select value={form.group_profile_id}
                  onChange={(e) => setForm({ ...form, group_profile_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                  <option value="">Pilih grup…</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · {group.pool_mode}
                    </option>
                  ))}
                </select>
                {groups.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-400">
                    Belum ada Group Profile tipe {type}. Buat dulu di Profile Group → Group Profile.
                  </p>
                )}
                {selectedGroup && (
                  // Semua nilai di bawah diwarisi dari grup. Profil ini hanya
                  // menetapkan grup + bandwidth + limitasi; tidak ada yang
                  // ditulis ke MikroTik.
                  <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 p-2 font-mono text-[11px] text-slate-400">
                    <div>pool     : {groupPool(selectedGroup)}</div>
                    <div>parent   : {selectedGroup.parent_queue ?? 'DEFAULT'}</div>
                    <div>dns      : {[selectedGroup.dns_primary, selectedGroup.dns_secondary].filter(Boolean).join(',') || '-'}</div>
                    <div>
                      profil   :{' '}
                      {selectedGroup.use_router_default === 1 || selectedGroup.pool_mode === 'group-pool'
                        ? 'bawaan router (tanpa Mikrotik-Group)'
                        : selectedGroup.name}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Bandwidth *</label>
                <select value={form.bandwidth_id}
                  onChange={(e) => setForm({ ...form, bandwidth_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                  <option value="">Pilih bandwidth…</option>
                  {bandwidths.map((bandwidth) => (
                    <option key={bandwidth.id} value={bandwidth.id}>
                      {bandwidth.name} ({bandwidth.max_upload_kbps}/{bandwidth.max_download_kbps} K)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Harga modal (kosong = 0)
                </label>
                <input type="number" min="0" value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Harga jual (kosong = gratis)
                </label>
                <input type="number" min="0" value={form.sell_price}
                  onChange={(e) => setForm({ ...form, sell_price: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Harga promo (0 = tidak ada)
                </label>
                <input type="number" min="0" value={form.promo_price}
                  onChange={(e) => setForm({ ...form, promo_price: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">PPN (%) — 0 = tanpa PPN</label>
                <input type="number" min="0" max="100" step="0.01" value={form.tax_percent}
                  onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>

              {!isHotspot && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Batas waktu per sesi (grup)</label>
                    <div className="flex gap-2">
                      <input type="number" min="0" value={form.time_limit_value}
                        onChange={(e) => setForm({ ...form, time_limit_value: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="0 = tanpa batas" />
                      <select value={form.time_limit_unit}
                        onChange={(e) => setForm({ ...form, time_limit_unit: e.target.value as FormState['time_limit_unit'] })}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100">
                        <option value="minute">menit</option>
                        <option value="hour">jam</option>
                        <option value="day">hari</option>
                      </select>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      <code>Session-Timeout</code> — berlaku untuk semua user di grup ini.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Batas kuota total (grup)</label>
                    <div className="flex gap-2">
                      <input type="number" min="0" value={form.quota_limit_value}
                        onChange={(e) => setForm({ ...form, quota_limit_value: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="0 = tanpa batas" />
                      <select value={form.quota_limit_unit}
                        onChange={(e) => setForm({ ...form, quota_limit_unit: e.target.value as FormState['quota_limit_unit'] })}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100">
                        <option value="MB">MB</option>
                        <option value="GB">GB</option>
                      </select>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      <code>Mikrotik-Total-Limit</code> — berlaku untuk semua user di grup ini.
                    </p>
                  </div>
                </>
              )}

              {isHotspot && (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">Tipe profil</label>
                  <select value={form.quota_type}
                    onChange={(e) => setForm({ ...form, quota_type: e.target.value as 'unlimited' | 'limited' })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                    <option value="unlimited">Unlimited (tanpa batas waktu/kuota)</option>
                    <option value="limited">Limited (ada batas waktu dan/atau kuota)</option>
                  </select>
                </div>
              )}

              {isHotspot && form.quota_type === 'limited' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Batas waktu online (timebase)</label>
                    <div className="flex gap-2">
                      <input type="number" min="1" value={form.timebase_value}
                        onChange={(e) => setForm({ ...form, timebase_value: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="5" />
                      <select value={form.timebase_unit}
                        onChange={(e) => setForm({ ...form, timebase_unit: e.target.value })}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100">
                        {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Batas kuota (quotabase)</label>
                    <div className="flex gap-2">
                      <input type="number" min="1" value={form.quotabase_value}
                        onChange={(e) => setForm({ ...form, quotabase_value: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                        placeholder="10" />
                      <select value={form.quotabase_unit}
                        onChange={(e) => setForm({ ...form, quotabase_unit: e.target.value })}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100">
                        <option value="MB">MB</option>
                        <option value="GB">GB</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-xs text-slate-400">Masa aktif (0 = tanpa batas)</label>
                <div className="flex gap-2">
                  <input type="number" min="0" value={form.validity_value}
                    onChange={(e) => setForm({ ...form, validity_value: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  <select value={form.validity_unit}
                    onChange={(e) => setForm({ ...form, validity_unit: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100">
                    {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                  </select>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Dihitung sejak login pertama.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Shared user</label>
                <input type="number" min="1" max="50" value={form.shared_users}
                  onChange={(e) => setForm({ ...form, shared_users: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                <p className="mt-1 text-[11px] text-slate-500">
                  {isHotspot
                    ? 'Lebih dari 1 hanya untuk profil unlimited.'
                    : selectedGroup?.pool_mode === 'sql-ippool'
                      ? 'Wajib 1 karena grup memakai SQL-IP-POOL.'
                      : 'Lebih dari 1 diizinkan untuk pool MikroTik.'}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Prioritas (1-8)</label>
                <input type="number" min="1" max="8" value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-400">Periode login</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <label key={day.value} className="flex items-center gap-1 text-xs text-slate-300">
                      <input type="checkbox" checked={form.login_days.includes(day.value)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            login_days: e.target.checked
                              ? [...form.login_days, day.value]
                              : form.login_days.filter((d) => d !== day.value),
                          })
                        } />
                      {day.label}
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input type="time" value={form.login_start}
                    onChange={(e) => setForm({ ...form, login_start: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  <span className="self-center text-xs text-slate-500">sampai</span>
                  <input type="time" value={form.login_end}
                    onChange={(e) => setForm({ ...form, login_end: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Kosongkan semua = bebas kapan saja. Hari tanpa centang = semua hari.
                </p>
              </div>
            </div>

            {invalid && (
              <p className="mt-2 text-xs text-amber-300">
                Periksa: nama, grup, bandwidth, harga jual &gt; 0, promo ≤ harga jual, dan aturan
                kuota/shared. Jam login harus diisi berpasangan.
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

      {preview && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-slate-100">
              Pratinjau: <span className="font-mono">{preview.groupname}</span>
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Harga: {rupiah(preview.price.base)} + PPN {rupiah(preview.price.tax)} ={' '}
              <span className="text-slate-200">{rupiah(preview.price.total)}</span>
              {preview.validity_seconds
                ? ` · masa aktif ${Math.round(preview.validity_seconds / 86400)} hari`
                : ' · tanpa masa aktif'}
            </p>

            <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Atribut RADIUS</p>
            <div className="mt-1 rounded-lg border border-slate-700 bg-black/70 p-3 font-mono text-[11px] text-slate-200">
              {preview.radius.reply.map((row, index) => (
                <div key={`r${index}`}>{row.attribute} := {row.value}</div>
              ))}
              {preview.radius.check.map((row, index) => (
                <div key={`c${index}`} className="text-amber-300">{row.attribute} := {row.value}</div>
              ))}
            </div>

            <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Dari Group Profile</p>
            <div className="mt-1 grid gap-1 rounded-lg border border-slate-700 bg-black/70 p-3 font-mono text-[11px] text-slate-300">
              <div>
                pool      :{' '}
                {preview.group.pool_mode === 'sql-ippool'
                  ? 'sql-ippool (RADIUS)'
                  : preview.group.pool_mode === 'group-pool'
                    ? 'profil hotspot bawaan router'
                    : `${preview.group.pool_name ?? '-'}${preview.group.pool_range ? ` ${preview.group.pool_range}` : ''}`}
              </div>
              <div>parent    : {preview.group.parent_queue ?? 'DEFAULT'}</div>
              <div>dns       : {preview.group.dns || '-'}</div>
              <div>profil    : {preview.group.local_profile ?? 'bawaan router (tanpa Mikrotik-Group)'}</div>
            </div>

            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
              Profil ini tidak menulis apa pun ke MikroTik. Yang disimpan hanya penetapan grup,
              bandwidth, dan limitasi; semuanya dikirim sebagai atribut RADIUS di atas.
              {preview.group.local_profile && (
                <> Profil lokal <span className="font-mono">{preview.group.local_profile}</span> sudah dibuat
                sekali oleh Group Profile.</>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={() => setPreview(null)}>Tutup</Button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-slate-100">Hapus profil?</h3>
            <p className="mt-2 text-sm text-slate-300">
              <span className="font-mono">{confirm.name}</span> akan dihapus beserta grup RADIUS-nya.
              Profil yang masih punya voucher tidak bisa dihapus.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirm(null)}>Batal</Button>
              <Button variant="danger" onClick={() => void remove()} disabled={busy}>Hapus</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceProfile;

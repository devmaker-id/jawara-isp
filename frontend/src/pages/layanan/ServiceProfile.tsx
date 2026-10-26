import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
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
  group_profile_id: number;
  bandwidth_id: number;
  cost_price: number;
  sell_price: number;
  promo_price: number;
  tax_percent: number;
  quota_type?: 'unlimited' | 'limited';
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
  pool_mode: string;
  parent_queue: string | null;
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
  mikrotik: Array<{ command: string; note: string }>;
  price: { base: number; tax: number; total: number };
  validity_seconds: number | null;
}

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
  group_profile_id: string;
  bandwidth_id: string;
  cost_price: string;
  sell_price: string;
  promo_price: string;
  tax_percent: string;
  quota_type: 'unlimited' | 'limited';
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
  group_profile_id: '',
  bandwidth_id: '',
  cost_price: '',
  sell_price: '',
  promo_price: '0',
  tax_percent: '0',
  quota_type: 'unlimited',
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ProfileRow | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
      name: row.name,
      group_profile_id: String(row.group_profile_id),
      bandwidth_id: String(row.bandwidth_id),
      cost_price: String(row.cost_price),
      sell_price: String(row.sell_price),
      promo_price: String(row.promo_price),
      tax_percent: String(row.tax_percent),
      quota_type: row.quota_type ?? 'unlimited',
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
    Number(form.sell_price) <= 0 ||
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
    if (isHotspot) {
      payload.quota_type = form.quota_type;
      if (form.quota_type === 'limited') {
        payload.timebase_value = form.timebase_value ? Number(form.timebase_value) : null;
        payload.timebase_unit = form.timebase_value ? form.timebase_unit : null;
        payload.quotabase_value = form.quotabase_value ? Number(form.quotabase_value) : null;
        payload.quotabase_unit = form.quotabase_value ? form.quotabase_unit : null;
      }
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
  const rupiah = (value: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

  return (
    <div className="page-container">
      <PageHeader
        title={`Layanan — Profil ${isHotspot ? 'Hotspot' : 'PPP'}`}
        subtitle={
          isHotspot
            ? 'Paket jual hotspot: harga, batas waktu/kuota, group profile, dan bandwidth.'
            : 'Paket jual PPP: harga, masa aktif, group profile, dan bandwidth. Tanpa quota base.'
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
              isAdmin ? 'Aksi' : '',
            ]}
            isEmpty={rows.length === 0}
            empty={`Belum ada profil ${type}.`}
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                <td className="px-3 py-2 text-xs">{groupName(row.group_profile_id)}</td>
                <td className="px-3 py-2 text-xs">{bwName(row.bandwidth_id)}</td>
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

              <div>
                <label className="mb-1 block text-xs text-slate-400">Group Profile *</label>
                <select value={form.group_profile_id}
                  onChange={(e) => setForm({ ...form, group_profile_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                  <option value="">Pilih grup…</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.pool_mode})
                    </option>
                  ))}
                </select>
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
                <label className="mb-1 block text-xs text-slate-400">Harga modal *</label>
                <input type="number" min="0" value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Harga jual *</label>
                <input type="number" min="0" value={form.sell_price}
                  onChange={(e) => setForm({ ...form, sell_price: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Harga promo (0 = tidak ada)</label>
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

            <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Perintah MikroTik</p>
            <div className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-700 bg-black/70 p-3 font-mono text-[11px] text-cyan-200">
              {preview.mikrotik.map((item, index) => (
                <div key={index} className="mb-1">{item.command}</div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Akun API saat ini read-only, jadi perintah di atas perlu dijalankan manual di router.
            </p>

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

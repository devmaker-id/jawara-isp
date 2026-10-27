import React, { useMemo, useState } from 'react';
import { TablePager, useTablePager } from '../../components/TablePager';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  InfoNote,
  Loading,
  PageHeader,
  SearchInput,
  StatCard,
  Table,
  Tabs,
  Toolbar,
  errorMessage,
  formatBytes,
  formatNumber,
  useDeviceSelection,
  DeviceBar,
  useNet,
} from '../../components/net/NetUI';

interface ServerRow {
  id: string;
  name: string;
  interface: string;
  profile: string;
  address_pool: string | null;
  disabled: boolean;
  idle_timeout: string | null;
}

interface ProfileRow {
  id: string;
  name: string;
  hotspot_address: string | null;
  dns_name: string | null;
  login_by: string | null;
  radius: boolean;
  radius_accounting: boolean;
}

interface UserRow {
  id: string;
  name: string;
  password: string;
  profile: string;
  server: string;
  limit_uptime: string;
  uptime: string;
  bytes_in: number;
  bytes_out: number;
  comment: string;
  disabled: boolean;
}

interface ActiveRow {
  id: string;
  user: string;
  address: string;
  mac_address: string | null;
  uptime: string;
  bytes_in: number;
  bytes_out: number;
  server: string;
}

interface FormState {
  id?: string;
  name: string;
  password: string;
  profile: string;
  server: string;
  limit_uptime: string;
  comment: string;
  disabled: boolean;
}

const emptyForm: FormState = {
  name: '',
  password: '',
  profile: 'default',
  server: 'all',
  limit_uptime: '',
  comment: '',
  disabled: false,
};

const Hotspot: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('users');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceSel = useDeviceSelection();
  const servers = useNet<ServerRow[]>('/api/mikrotik/hotspot/servers' + deviceSel.query);
  const profiles = useNet<ProfileRow[]>('/api/mikrotik/hotspot/profiles' + deviceSel.query);
  const users = useNet<UserRow[]>('/api/mikrotik/hotspot/users' + deviceSel.query);
  const active = useNet<ActiveRow[]>('/api/mikrotik/hotspot/active' + deviceSel.query);

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users.data ?? [];
    return (users.data ?? []).filter((row) =>
      `${row.name} ${row.profile} ${row.server} ${row.comment}`.toLowerCase().includes(needle),
    );
  }, [users.data, search]);

  const filteredActive = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return active.data ?? [];
    return (active.data ?? []).filter((row) =>
      `${row.user} ${row.address} ${row.server}`.toLowerCase().includes(needle),
    );
  }, [active.data, search]);

  // Daftar user & sesi hotspot bisa panjang; tampilkan sebagian per halaman.
  const userPager = useTablePager(filteredUsers, 25);
  const activePager = useTablePager(filteredActive, 25);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setActionError(null);
    const payload: Record<string, unknown> = {
      profile: form.profile || undefined,
      server: form.server && form.server !== 'all' ? form.server : undefined,
      limit_uptime: form.limit_uptime || undefined,
      comment: form.comment || undefined,
      disabled: form.disabled,
    };
    if (form.password) payload.password = form.password;
    try {
      if (form.id) {
        await api.patch(`/api/mikrotik/hotspot/users/${encodeURIComponent(form.id)}` + deviceSel.query, payload);
      } else {
        await api.post('/api/mikrotik/hotspot/users' + deviceSel.query, { ...payload, name: form.name });
      }
      setForm(null);
      users.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: UserRow) => {
    if (!window.confirm(`Hapus user hotspot "${row.name}" dari perangkat?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/mikrotik/hotspot/users/${encodeURIComponent(row.id)}` + deviceSel.query);
      users.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — Hotspot"
        subtitle="Server, profil, user voucer, dan sesi hotspot yang sedang aktif di perangkat."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Server" value={formatNumber(servers.data?.length)} hint="hotspot server aktif di konfigurasi" />
        <StatCard label="User terdaftar" value={formatNumber(users.data?.length)} hint="termasuk user dinamis" />
        <StatCard label="Sesi aktif" value={formatNumber(active.data?.length)} tone="good" hint="login saat ini" />
        <StatCard label="Profil" value={formatNumber(profiles.data?.length)} hint="profil hotspot" />
      </div>

      <Tabs
        tabs={[
          { key: 'users', label: 'User', count: users.data?.length },
          { key: 'active', label: 'Sesi Aktif', count: active.data?.length },
          { key: 'servers', label: 'Server', count: servers.data?.length },
          { key: 'profiles', label: 'Profil', count: profiles.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {actionError && <div className="mb-3"><ErrorNote message={actionError} /></div>}

      {tab === 'users' && (
        <>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Cari nama / profil / komentar…" />
            {isAdmin && (
              <Button variant="primary" onClick={() => setForm({ ...emptyForm })}>
                + Tambah user
              </Button>
            )}
          </Toolbar>
          {users.loading && <Loading />}
          {users.error && <ErrorNote message={users.error} onRetry={users.reload} />}
          {!users.loading && !users.error && (
            <Table
              columns={['Nama', 'Profil', 'Server', 'Batas uptime', 'Pemakaian', 'Status', 'Komentar', isAdmin ? 'Aksi' : '']}
              isEmpty={filteredUsers.length === 0}
              empty={search ? 'Tidak ada user yang cocok.' : 'Belum ada user hotspot di perangkat.'}
            >
              {userPager.pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 text-slate-400">{row.profile}</td>
                  <td className="px-3 py-2 text-slate-400">{row.server}</td>
                  <td className="px-3 py-2 text-slate-400">{row.limit_uptime || '-'}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">
                    ↓ {formatBytes(row.bytes_in)} · ↑ {formatBytes(row.bytes_out)}
                  </td>
                  <td className="px-3 py-2">
                    {row.disabled ? <Badge tone="bad">nonaktif</Badge> : <Badge tone="good">aktif</Badge>}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
                  {isAdmin && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="mr-2 text-xs text-cyan-400 hover:underline"
                        onClick={() =>
                          setForm({
                            id: row.id,
                            name: row.name,
                            password: '',
                            profile: row.profile,
                            server: row.server,
                            limit_uptime: row.limit_uptime,
                            comment: row.comment,
                            disabled: row.disabled,
                          })
                        }
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        className="text-xs text-rose-400 hover:underline"
                        onClick={() => remove(row)}
                      >
                        Hapus
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
          {filteredUsers.length > 0 && <TablePager unit="user" {...userPager.pagerProps} />}
        </>
      )}

      {tab === 'active' && (
        <>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Cari user / IP…" />
          </Toolbar>
          {active.loading && <Loading />}
          {active.error && <ErrorNote message={active.error} onRetry={active.reload} />}
          {!active.loading && !active.error && (
            <Table
              columns={['User', 'IP', 'MAC', 'Server', 'Uptime', 'Traffic']}
              isEmpty={filteredActive.length === 0}
              empty="Tidak ada sesi hotspot aktif."
            >
              {activePager.pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.user}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.address}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.mac_address ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.server}</td>
                  <td className="px-3 py-2 text-slate-300">{row.uptime}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">
                    ↓ {formatBytes(row.bytes_in)} · ↑ {formatBytes(row.bytes_out)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {filteredActive.length > 0 && (
            <TablePager unit="sesi" {...activePager.pagerProps} />
          )}
        </>
      )}

      {tab === 'servers' && (
        <>
          {servers.loading && <Loading />}
          {servers.error && <ErrorNote message={servers.error} onRetry={servers.reload} />}
          {!servers.loading && !servers.error && (
            <Table
              columns={['Nama', 'Interface', 'Profil', 'Address pool', 'Idle timeout', 'Status']}
              isEmpty={(servers.data?.length ?? 0) === 0}
              empty="Belum ada hotspot server dikonfigurasi di perangkat."
            >
              {(servers.data ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 text-slate-400">{row.interface}</td>
                  <td className="px-3 py-2 text-slate-400">{row.profile}</td>
                  <td className="px-3 py-2 text-slate-400">{row.address_pool ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.idle_timeout ?? '-'}</td>
                  <td className="px-3 py-2">
                    {row.disabled ? <Badge tone="bad">nonaktif</Badge> : <Badge tone="good">aktif</Badge>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {tab === 'profiles' && (
        <>
          {profiles.loading && <Loading />}
          {profiles.error && <ErrorNote message={profiles.error} onRetry={profiles.reload} />}
          {!profiles.loading && !profiles.error && (
            <Table
              columns={['Nama', 'Hotspot address', 'DNS', 'Login by', 'RADIUS', 'Accounting']}
              isEmpty={(profiles.data?.length ?? 0) === 0}
              empty="Belum ada profil hotspot."
            >
              {(profiles.data ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 text-slate-400">{row.hotspot_address ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.dns_name ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.login_by ?? '-'}</td>
                  <td className="px-3 py-2">
                    {row.radius ? <Badge tone="good">ya</Badge> : <Badge tone="mute">tidak</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    {row.radius_accounting ? <Badge tone="good">ya</Badge> : <Badge tone="mute">tidak</Badge>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form
            onSubmit={submit}
            className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5"
          >
            <h2 className="mb-4 text-lg font-semibold text-white">
              {form.id ? `Ubah user hotspot: ${form.name}` : 'Tambah user hotspot'}
            </h2>

            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-slate-300">Nama user</span>
                <input
                  required
                  disabled={Boolean(form.id)}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 disabled:opacity-60"
                />
              </label>

              <label className="block text-sm">
                <span className="text-slate-300">
                  Password {form.id && <span className="text-xs text-slate-500">(kosongkan bila tidak diubah)</span>}
                </span>
                <input
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  placeholder="Kosongkan = sama dengan nama user"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">Profil</span>
                  <select
                    value={form.profile}
                    onChange={(event) => setForm({ ...form, profile: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  >
                    {['default', ...(profiles.data ?? []).map((row) => row.name)]
                      .filter((value, index, all) => all.indexOf(value) === index)
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Server</span>
                  <select
                    value={form.server}
                    onChange={(event) => setForm({ ...form, server: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  >
                    {['all', ...(servers.data ?? []).map((row) => row.name)]
                      .filter((value, index, all) => all.indexOf(value) === index)
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">Batas uptime</span>
                  <input
                    value={form.limit_uptime}
                    onChange={(event) => setForm({ ...form, limit_uptime: event.target.value })}
                    placeholder="mis. 1d / 04:00:00"
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Komentar</span>
                  <input
                    value={form.comment}
                    onChange={(event) => setForm({ ...form, comment: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.disabled}
                  onChange={(event) => setForm({ ...form, disabled: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                Nonaktifkan user ini
              </label>

              <InfoNote>
                Perubahan dikirim langsung ke MikroTik dan hanya berhasil bila mode tulis aktif
                (<code className="text-slate-200">mikrotik_write_enabled</code>).
              </InfoNote>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setForm(null)} disabled={saving}>
                Batal
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-4">
        <Card>
          <p className="text-xs text-slate-400">
            Catatan: daftar user hotspot dibaca langsung dari perangkat (bukan dari database billing). User dinamis
            dari login voucer ikut tampil bila perangkat menandainya demikian.
          </p>
        </Card>
      </div>
    </div>
  );
};

export default Hotspot;
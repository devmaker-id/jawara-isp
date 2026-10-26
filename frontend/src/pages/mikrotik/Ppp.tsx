import React, { useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Badge,
  Button,
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
  formatNumber,
  useDeviceSelection,
  DeviceBar,
  useNet,
} from '../../components/net/NetUI';

interface PppProfileRow {
  id: string;
  name: string;
  local_address: string | null;
  remote_address: string | null;
  rate_limit: string | null;
  dns_server: string | null;
  use_radius: boolean | null;
}

interface PppSecretRow {
  id: string;
  name: string;
  service: string;
  profile: string;
  remote_address: string;
  local_address: string;
  comment: string;
  disabled: boolean;
}

interface PppActiveRow {
  id: string;
  name: string;
  service: string;
  address: string;
  caller_id: string;
  uptime: string;
  encoding: string;
}

interface SecretForm {
  id?: string;
  name: string;
  password: string;
  service: 'any' | 'pppoe' | 'pptp' | 'l2tp' | 'ovpn';
  profile: string;
  remote_address: string;
  comment: string;
  disabled: boolean;
}

const emptySecret: SecretForm = {
  name: '',
  password: '',
  service: 'pppoe',
  profile: 'default',
  remote_address: '',
  comment: '',
  disabled: false,
};

const Ppp: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<SecretForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceSel = useDeviceSelection();
  const active = useNet<PppActiveRow[]>('/api/mikrotik/ppp/active' + deviceSel.query);
  const secrets = useNet<PppSecretRow[]>('/api/mikrotik/ppp/secrets' + deviceSel.query);
  const profiles = useNet<PppProfileRow[]>('/api/mikrotik/ppp/profiles' + deviceSel.query);

  const filteredSecrets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return secrets.data ?? [];
    return (secrets.data ?? []).filter((row) =>
      `${row.name} ${row.service} ${row.remote_address} ${row.comment}`.toLowerCase().includes(needle),
    );
  }, [secrets.data, search]);

  const filteredActive = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return active.data ?? [];
    return (active.data ?? []).filter((row) =>
      `${row.name} ${row.address} ${row.caller_id}`.toLowerCase().includes(needle),
    );
  }, [active.data, search]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setActionError(null);
    const payload: Record<string, unknown> = {
      service: form.service,
      profile: form.profile || undefined,
      remote_address: form.remote_address || undefined,
      comment: form.comment || undefined,
      disabled: form.disabled,
    };
    if (form.password) payload.password = form.password;
    try {
      if (form.id) {
        await api.patch(`/api/mikrotik/ppp/secrets/${encodeURIComponent(form.id)}` + deviceSel.query, payload);
      } else {
        await api.post('/api/mikrotik/ppp/secrets' + deviceSel.query, { ...payload, name: form.name });
      }
      setForm(null);
      secrets.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: PppSecretRow) => {
    if (!window.confirm(`Hapus PPP secret "${row.name}" dari perangkat?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/mikrotik/ppp/secrets/${encodeURIComponent(row.id)}` + deviceSel.query);
      secrets.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — PPP"
        subtitle="Sesi PPPoE/PPTP/L2TP yang aktif, daftar secret, dan profil PPP di perangkat."
        actions={
          <Button
            onClick={() => {
              active.reload();
              secrets.reload();
              profiles.reload();
            }}
          >
            Muat ulang
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Sesi PPP aktif" value={formatNumber(active.data?.length)} tone="good" />
        <StatCard label="Secret terdaftar" value={formatNumber(secrets.data?.length)} />
        <StatCard label="Profil PPP" value={formatNumber(profiles.data?.length)} />
      </div>

      <Tabs
        tabs={[
          { key: 'active', label: 'Sesi Aktif', count: active.data?.length },
          { key: 'secrets', label: 'Secret', count: secrets.data?.length },
          { key: 'profiles', label: 'Profil', count: profiles.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {actionError && <div className="mb-3"><ErrorNote message={actionError} /></div>}

      {tab === 'active' && (
        <>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Cari nama / IP…" />
          </Toolbar>
          {active.loading && <Loading />}
          {active.error && <ErrorNote message={active.error} onRetry={active.reload} />}
          {!active.loading && !active.error && (
            <Table
              columns={['Nama', 'Service', 'IP', 'Caller ID', 'Uptime', 'Encoding']}
              isEmpty={filteredActive.length === 0}
              empty="Tidak ada sesi PPP aktif."
            >
              {filteredActive.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 text-slate-400">{row.service}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.address}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.caller_id || '-'}</td>
                  <td className="px-3 py-2 text-slate-300">{row.uptime}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{row.encoding || '-'}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {tab === 'secrets' && (
        <>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Cari nama / IP / komentar…" />
            {isAdmin && (
              <Button variant="primary" onClick={() => setForm({ ...emptySecret })}>
                + Tambah secret
              </Button>
            )}
          </Toolbar>
          {secrets.loading && <Loading />}
          {secrets.error && <ErrorNote message={secrets.error} onRetry={secrets.reload} />}
          {!secrets.loading && !secrets.error && (
            <Table
              columns={['Nama', 'Service', 'Profil', 'Remote address', 'Komentar', 'Status', isAdmin ? 'Aksi' : '']}
              isEmpty={filteredSecrets.length === 0}
              empty={search ? 'Tidak ada secret yang cocok.' : 'Belum ada PPP secret di perangkat.'}
            >
              {filteredSecrets.map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 text-slate-400">{row.service}</td>
                  <td className="px-3 py-2 text-slate-400">{row.profile}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.remote_address || '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
                  <td className="px-3 py-2">
                    {row.disabled ? <Badge tone="bad">nonaktif</Badge> : <Badge tone="good">aktif</Badge>}
                  </td>
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
                            service: (row.service as SecretForm['service']) || 'pppoe',
                            profile: row.profile,
                            remote_address: row.remote_address,
                            comment: row.comment,
                            disabled: row.disabled,
                          })
                        }
                      >
                        Ubah
                      </button>
                      <button type="button" className="text-xs text-rose-400 hover:underline" onClick={() => remove(row)}>
                        Hapus
                      </button>
                    </td>
                  )}
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
              columns={['Nama', 'Local address', 'Remote address', 'Rate limit', 'DNS', 'RADIUS']}
              isEmpty={(profiles.data?.length ?? 0) === 0}
              empty="Belum ada profil PPP."
            >
              {(profiles.data ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.local_address ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.remote_address ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-300">{row.rate_limit ?? '-'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.dns_server ?? '-'}</td>
                  <td className="px-3 py-2">
                    {row.use_radius === null ? (
                      <Badge tone="mute">-</Badge>
                    ) : row.use_radius ? (
                      <Badge tone="good">ya</Badge>
                    ) : (
                      <Badge tone="mute">tidak</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={submit} className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {form.id ? `Ubah PPP secret: ${form.name}` : 'Tambah PPP secret'}
            </h2>

            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-slate-300">Nama</span>
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
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">Service</span>
                  <select
                    value={form.service}
                    onChange={(event) => setForm({ ...form, service: event.target.value as SecretForm['service'] })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  >
                    {(['pppoe', 'pptp', 'l2tp', 'ovpn', 'any'] as const).map((service) => (
                      <option key={service} value={service}>
                        {service}
                      </option>
                    ))}
                  </select>
                </label>

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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">Remote address</span>
                  <input
                    value={form.remote_address}
                    onChange={(event) => setForm({ ...form, remote_address: event.target.value })}
                    placeholder="mis. 10.10.0.2"
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
                Nonaktifkan secret ini
              </label>

              <InfoNote>
                Penambahan secret tidak otomatis membuat pelanggan di panel billing. Hubungkan manual lewat menu
                Layanan agar pencatatan tetap konsisten.
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
    </div>
  );
};

export default Ppp;
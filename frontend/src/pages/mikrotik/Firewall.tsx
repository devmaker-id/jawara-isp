import React, { useMemo, useState } from 'react';
import { TablePager, useTablePager } from '../../components/TablePager';
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
import { RowActions } from '../../components/table/RowActions';

type FirewallTableKey = 'filter' | 'nat' | 'mangle';

interface FirewallRow {
  id: string;
  chain: string;
  action: string;
  protocol: string;
  src_address: string;
  dst_address: string;
  src_port: string;
  dst_port: string;
  in_interface: string;
  out_interface: string;
  connection_state: string;
  to_addresses: string;
  to_ports: string;
  new_connection_mark: string;
  new_routing_mark: string;
  new_packet_mark: string;
  comment: string;
  disabled: boolean;
}

interface AddressListRow {
  id: string;
  list: string;
  address: string;
  comment: string;
  dynamic: boolean;
  disabled: boolean;
}

interface RuleForm {
  id?: string;
  chain: string;
  action: string;
  protocol: string;
  src_address: string;
  dst_address: string;
  src_port: string;
  dst_port: string;
  in_interface: string;
  out_interface: string;
  connection_state: string;
  to_addresses: string;
  to_ports: string;
  new_connection_mark: string;
  new_routing_mark: string;
  new_packet_mark: string;
  comment: string;
  disabled: boolean;
}

interface AddrForm {
  id?: string;
  list: string;
  address: string;
  comment: string;
  disabled: boolean;
}

const emptyRule: RuleForm = {
  chain: 'forward',
  action: 'accept',
  protocol: '',
  src_address: '',
  dst_address: '',
  src_port: '',
  dst_port: '',
  in_interface: '',
  out_interface: '',
  connection_state: '',
  to_addresses: '',
  to_ports: '',
  new_connection_mark: '',
  new_routing_mark: '',
  new_packet_mark: '',
  comment: '',
  disabled: false,
};

const emptyAddr: AddrForm = { list: '', address: '', comment: '', disabled: false };

// Ringkasan kolom "Detail" per tabel supaya tabel tidak kelebihan kolom.
function ruleDetail(row: FirewallRow, table: FirewallTableKey): string {
  const parts: string[] = [];
  if (row.src_port || row.dst_port) parts.push(`port ${row.src_port || 'any'}→${row.dst_port || 'any'}`);
  if (row.connection_state) parts.push(row.connection_state);
  if (table === 'nat') {
    if (row.to_addresses) parts.push(`to ${row.to_addresses}`);
    if (row.to_ports) parts.push(`to-port ${row.to_ports}`);
  }
  if (table === 'mangle') {
    if (row.new_routing_mark) parts.push(`routing-mark ${row.new_routing_mark}`);
    if (row.new_connection_mark) parts.push(`conn-mark ${row.new_connection_mark}`);
    if (row.new_packet_mark) parts.push(`pkt-mark ${row.new_packet_mark}`);
  }
  if (row.in_interface) parts.push(`in ${row.in_interface}`);
  if (row.out_interface) parts.push(`out ${row.out_interface}`);
  return parts.join(' · ');
}

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100';

const SendField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block text-sm">
    <span className="text-slate-300">{label}</span>
    {children}
  </label>
);

const Firewall: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'filter' | 'nat' | 'mangle' | 'address'>('filter');
  const [search, setSearch] = useState('');
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [addrForm, setAddrForm] = useState<AddrForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceSel = useDeviceSelection();
  const filter = useNet<FirewallRow[]>('/api/mikrotik/firewall/filter' + deviceSel.query);
  const nat = useNet<FirewallRow[]>('/api/mikrotik/firewall/nat' + deviceSel.query);
  const mangle = useNet<FirewallRow[]>('/api/mikrotik/firewall/mangle' + deviceSel.query);
  const addressList = useNet<AddressListRow[]>('/api/mikrotik/firewall/address-list' + deviceSel.query);

  const needle = search.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

  const filteredRules = useMemo(
    () =>
      (filter.data ?? []).filter((row) =>
        matches(`${row.chain} ${row.action} ${row.protocol} ${row.src_address} ${row.dst_address} ${row.comment}`),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter.data, needle],
  );
  const filteredNat = useMemo(
    () => (nat.data ?? []).filter((row) => matches(`${row.chain} ${row.action} ${row.to_addresses} ${row.comment}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nat.data, needle],
  );
  const filteredMangle = useMemo(
    () =>
      (mangle.data ?? []).filter((row) =>
        matches(`${row.chain} ${row.action} ${row.new_routing_mark} ${row.new_connection_mark} ${row.comment}`),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mangle.data, needle],
  );
  const filteredAddress = useMemo(
    () => (addressList.data ?? []).filter((row) => matches(`${row.list} ${row.address} ${row.comment}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addressList.data, needle],
  );

  const activeRules: FirewallRow[] =
    tab === 'filter' ? filteredRules : tab === 'nat' ? filteredNat : filteredMangle;

  const current = tab === 'filter' ? filter : tab === 'nat' ? nat : tab === 'mangle' ? mangle : addressList;
  const activeReload = tab === 'filter'
    ? filter.reload
    : tab === 'nat'
      ? nat.reload
      : tab === 'mangle'
        ? mangle.reload
        : addressList.reload;

  const rulePager = useTablePager(activeRules, 25);
  const addrPager = useTablePager(filteredAddress, 25);

  const saveRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ruleForm) return;
    setSaving(true);
    setActionError(null);
    const table = tab as FirewallTableKey;
    const payload: Record<string, unknown> = {
      chain: ruleForm.chain || undefined,
      action: ruleForm.action || undefined,
      protocol: ruleForm.protocol || undefined,
      src_address: ruleForm.src_address || undefined,
      dst_address: ruleForm.dst_address || undefined,
      src_port: ruleForm.src_port || undefined,
      dst_port: ruleForm.dst_port || undefined,
      in_interface: ruleForm.in_interface || undefined,
      out_interface: ruleForm.out_interface || undefined,
      connection_state: ruleForm.connection_state || undefined,
      to_addresses: ruleForm.to_addresses || undefined,
      to_ports: ruleForm.to_ports || undefined,
      new_connection_mark: ruleForm.new_connection_mark || undefined,
      new_routing_mark: ruleForm.new_routing_mark || undefined,
      new_packet_mark: ruleForm.new_packet_mark || undefined,
      comment: ruleForm.comment || undefined,
      disabled: ruleForm.disabled,
    };
    try {
      if (ruleForm.id) {
        await api.patch(`/api/mikrotik/firewall/${table}/${encodeURIComponent(ruleForm.id)}` + deviceSel.query, payload);
      } else {
        await api.post(`/api/mikrotik/firewall/${table}` + deviceSel.query, payload);
      }
      setRuleForm(null);
      activeReload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveAddr = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!addrForm) return;
    setSaving(true);
    setActionError(null);
    try {
      if (addrForm.id) {
        await api.patch(
          `/api/mikrotik/firewall/address-list/${encodeURIComponent(addrForm.id)}` + deviceSel.query,
          {
            list: addrForm.list || undefined,
            address: addrForm.address || undefined,
            comment: addrForm.comment || undefined,
            disabled: addrForm.disabled,
          },
        );
      } else {
        await api.post('/api/mikrotik/firewall/address-list' + deviceSel.query, {
          list: addrForm.list,
          address: addrForm.address,
          comment: addrForm.comment || undefined,
          disabled: addrForm.disabled,
        });
      }
      setAddrForm(null);
      addressList.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (row: FirewallRow) => {
    if (!window.confirm(`Hapus aturan firewall "${row.chain} ${row.action}" dari perangkat?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/mikrotik/firewall/${tab}/${encodeURIComponent(row.id)}` + deviceSel.query);
      activeReload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const removeAddr = async (row: AddressListRow) => {
    if (!window.confirm(`Hapus address-list "${row.address}" (${row.list}) dari perangkat?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/mikrotik/firewall/address-list/${encodeURIComponent(row.id)}` + deviceSel.query);
      addressList.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const ruleColumns = ['Chain', 'Action', 'Protocol', 'Src address', 'Dst address', 'Detail', 'Komentar', 'Status', isAdmin ? 'Aksi' : ''];
  const addrColumns = ['List', 'Address', 'Komentar', 'Tipe', 'Status', isAdmin ? 'Aksi' : ''];

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — Firewall"
        subtitle="Aturan filter, NAT, mangle, dan address-list di perangkat. Tulis membutuhkan perangkat write_enabled (role admin)."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Filter" value={formatNumber(filter.data?.length)} />
        <StatCard label="NAT" value={formatNumber(nat.data?.length)} />
        <StatCard label="Mangle" value={formatNumber(mangle.data?.length)} />
        <StatCard label="Address-list" value={formatNumber(addressList.data?.length)} />
      </div>

      <Tabs
        tabs={[
          { key: 'filter', label: 'Filter', count: filter.data?.length },
          { key: 'nat', label: 'NAT', count: nat.data?.length },
          { key: 'mangle', label: 'Mangle', count: mangle.data?.length },
          { key: 'address', label: 'Address-list', count: addressList.data?.length },
        ]}
        active={tab}
        onChange={(key) => setTab(key as 'filter' | 'nat' | 'mangle' | 'address')}
      />

      {actionError && <div className="mb-3"><ErrorNote message={actionError} /></div>}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Cari chain / alamat / komentar…" />
        {isAdmin && tab !== 'address' && (
          <Button variant="primary" onClick={() => setRuleForm({ ...emptyRule, chain: tab === 'nat' ? 'srcnat' : 'forward' })}>
            + Tambah aturan
          </Button>
        )}
        {isAdmin && tab === 'address' && (
          <Button variant="primary" onClick={() => setAddrForm({ ...emptyAddr })}>
            + Tambah address-list
          </Button>
        )}
      </Toolbar>

      {current.loading && <Loading />}
      {current.error && <ErrorNote message={current.error} onRetry={activeReload} />}

      {!current.loading && !current.error && tab !== 'address' && (
        <>
          <Table
            columns={ruleColumns}
            isEmpty={activeRules.length === 0}
            empty={search ? 'Tidak ada aturan yang cocok.' : 'Belum ada aturan di tabel ini.'}
          >
            {rulePager.pageRows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-700/30">
                <td className="px-3 py-2 font-medium text-slate-100">{row.chain}</td>
                <td className="px-3 py-2">
                  <Badge tone={row.action === 'drop' || row.action === 'reject' ? 'bad' : row.action === 'accept' ? 'good' : 'mute'}>
                    {row.action}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.protocol || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.src_address || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.dst_address || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">{ruleDetail(row, tab as FirewallTableKey) || '-'}</td>
                <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
                <td className="px-3 py-2">
                  {row.disabled ? <Badge tone="mute">nonaktif</Badge> : <Badge tone="good">aktif</Badge>}
                </td>
                {isAdmin && (
                  <td className="actions">
                    <RowActions
                      label={`Aksi untuk aturan ${row.chain}`}
                      actions={[
                        {
                          key: 'edit',
                          label: 'Ubah aturan',
                          onSelect: () =>
                            setRuleForm({
                              id: row.id,
                              chain: row.chain,
                              action: row.action,
                              protocol: row.protocol,
                              src_address: row.src_address,
                              dst_address: row.dst_address,
                              src_port: row.src_port,
                              dst_port: row.dst_port,
                              in_interface: row.in_interface,
                              out_interface: row.out_interface,
                              connection_state: row.connection_state,
                              to_addresses: row.to_addresses,
                              to_ports: row.to_ports,
                              new_connection_mark: row.new_connection_mark,
                              new_routing_mark: row.new_routing_mark,
                              new_packet_mark: row.new_packet_mark,
                              comment: row.comment,
                              disabled: row.disabled,
                            }),
                        },
                        { key: 'delete', label: 'Hapus aturan', tone: 'danger', onSelect: () => removeRule(row) },
                      ]}
                    />
                  </td>
                )}
              </tr>
            ))}
          </Table>
          {activeRules.length > 0 && <TablePager unit="aturan" {...rulePager.pagerProps} />}
        </>
      )}

      {!current.loading && !current.error && tab === 'address' && (
        <>
          <Table
            columns={addrColumns}
            isEmpty={filteredAddress.length === 0}
            empty={search ? 'Tidak ada address-list yang cocok.' : 'Belum ada entri address-list.'}
          >
            {addrPager.pageRows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-700/30">
                <td className="px-3 py-2">
                  <Badge tone={row.dynamic ? 'mute' : 'good'}>{row.list}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-100">{row.address}</td>
                <td className="px-3 py-2 text-slate-400">{row.comment || '-'}</td>
                <td className="px-3 py-2 text-slate-400">{row.dynamic ? 'dynamic' : 'static'}</td>
                <td className="px-3 py-2">
                  {row.disabled ? <Badge tone="mute">nonaktif</Badge> : <Badge tone="good">aktif</Badge>}
                </td>
                {isAdmin && (
                  <td className="actions">
                    <RowActions
                      label={`Aksi untuk ${row.address}`}
                      actions={[
                        {
                          key: 'edit',
                          label: 'Ubah entri',
                          onSelect: () =>
                            setAddrForm({
                              id: row.id,
                              list: row.list,
                              address: row.address,
                              comment: row.comment,
                              disabled: row.disabled,
                            }),
                        },
                        { key: 'delete', label: 'Hapus entri', tone: 'danger', onSelect: () => removeAddr(row) },
                      ]}
                    />
                  </td>
                )}
              </tr>
            ))}
          </Table>
          {filteredAddress.length > 0 && <TablePager unit="entri" {...addrPager.pagerProps} />}
        </>
      )}

      {ruleForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={saveRule} className="mt-10 w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {ruleForm.id ? `Ubah aturan firewall (${tab})` : `Tambah aturan firewall (${tab})`}
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <SendField label="Chain">
                  <input required value={ruleForm.chain} onChange={(e) => setRuleForm({ ...ruleForm, chain: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Action">
                  <select value={ruleForm.action} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })} className={inputCls}>
                    {['accept', 'drop', 'reject', 'masquerade', 'src-nat', 'dst-nat', 'netmap', 'mark-connection', 'mark-routing', 'mark-packet', 'passthrough', 'tarpit'].map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </SendField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SendField label="Protocol">
                  <input value={ruleForm.protocol} onChange={(e) => setRuleForm({ ...ruleForm, protocol: e.target.value })} placeholder="tcp/udp/icmp" className={inputCls} />
                </SendField>
                <SendField label="Connection state">
                  <input value={ruleForm.connection_state} onChange={(e) => setRuleForm({ ...ruleForm, connection_state: e.target.value })} placeholder="new,established" className={inputCls} />
                </SendField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SendField label="Src address">
                  <input value={ruleForm.src_address} onChange={(e) => setRuleForm({ ...ruleForm, src_address: e.target.value })} placeholder="192.168.1.0/24" className={inputCls} />
                </SendField>
                <SendField label="Dst address">
                  <input value={ruleForm.dst_address} onChange={(e) => setRuleForm({ ...ruleForm, dst_address: e.target.value })} className={inputCls} />
                </SendField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SendField label="Src port">
                  <input value={ruleForm.src_port} onChange={(e) => setRuleForm({ ...ruleForm, src_port: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Dst port">
                  <input value={ruleForm.dst_port} onChange={(e) => setRuleForm({ ...ruleForm, dst_port: e.target.value })} className={inputCls} />
                </SendField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SendField label="In interface">
                  <input value={ruleForm.in_interface} onChange={(e) => setRuleForm({ ...ruleForm, in_interface: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Out interface">
                  <input value={ruleForm.out_interface} onChange={(e) => setRuleForm({ ...ruleForm, out_interface: e.target.value })} className={inputCls} />
                </SendField>
              </div>
              {tab === 'nat' && (
                <div className="grid grid-cols-2 gap-3">
                  <SendField label="To addresses">
                    <input value={ruleForm.to_addresses} onChange={(e) => setRuleForm({ ...ruleForm, to_addresses: e.target.value })} className={inputCls} />
                  </SendField>
                  <SendField label="To ports">
                    <input value={ruleForm.to_ports} onChange={(e) => setRuleForm({ ...ruleForm, to_ports: e.target.value })} className={inputCls} />
                  </SendField>
                </div>
              )}
              {tab === 'mangle' && (
                <div className="grid grid-cols-3 gap-3">
                  <SendField label="New routing mark">
                    <input value={ruleForm.new_routing_mark} onChange={(e) => setRuleForm({ ...ruleForm, new_routing_mark: e.target.value })} className={inputCls} />
                  </SendField>
                  <SendField label="New connection mark">
                    <input value={ruleForm.new_connection_mark} onChange={(e) => setRuleForm({ ...ruleForm, new_connection_mark: e.target.value })} className={inputCls} />
                  </SendField>
                  <SendField label="New packet mark">
                    <input value={ruleForm.new_packet_mark} onChange={(e) => setRuleForm({ ...ruleForm, new_packet_mark: e.target.value })} className={inputCls} />
                  </SendField>
                </div>
              )}
              <SendField label="Komentar">
                <input value={ruleForm.comment} onChange={(e) => setRuleForm({ ...ruleForm, comment: e.target.value })} className={inputCls} />
              </SendField>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={ruleForm.disabled} onChange={(e) => setRuleForm({ ...ruleForm, disabled: e.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                Nonaktifkan aturan ini
              </label>
              <InfoNote tone="warn">
                Perubahan menulis langsung ke firewall perangkat produksi. Pastikan chain & action sudah benar sebelum menyimpan.
              </InfoNote>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setRuleForm(null)} disabled={saving}>Batal</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
            </div>
          </form>
        </div>
      )}

      {addrForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={saveAddr} className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {addrForm.id ? 'Ubah address-list' : 'Tambah address-list'}
            </h2>
            <div className="space-y-3">
              <SendField label="List (nama)">
                <input required value={addrForm.list} onChange={(e) => setAddrForm({ ...addrForm, list: e.target.value })} placeholder="banned" className={inputCls} />
              </SendField>
              <SendField label="Address">
                <input required value={addrForm.address} onChange={(e) => setAddrForm({ ...addrForm, address: e.target.value })} placeholder="203.0.113.5" className={inputCls} />
              </SendField>
              <SendField label="Komentar">
                <input value={addrForm.comment} onChange={(e) => setAddrForm({ ...addrForm, comment: e.target.value })} className={inputCls} />
              </SendField>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={addrForm.disabled} onChange={(e) => setAddrForm({ ...addrForm, disabled: e.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                Nonaktifkan entri ini
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setAddrForm(null)} disabled={saving}>Batal</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Firewall;
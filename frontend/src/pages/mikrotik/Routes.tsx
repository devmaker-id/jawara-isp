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

interface RouteRow {
  id: string;
  dst_address: string;
  gateway: string;
  distance: number;
  scope: number;
  target_scope: number;
  routing_table: string;
  routing_mark: string;
  pref_src: string;
  comment: string;
  active: boolean;
  static: boolean;
  dynamic: boolean;
  disabled: boolean;
}

interface RouteRuleRow {
  id: string;
  src_address: string;
  dst_address: string;
  table: string;
  routing_mark: string;
  action: string;
  comment: string;
  disabled: boolean;
}

interface RouteForm {
  id?: string;
  dst_address: string;
  gateway: string;
  distance: string;
  scope: string;
  target_scope: string;
  routing_table: string;
  routing_mark: string;
  comment: string;
  disabled: boolean;
}

interface RuleForm {
  id?: string;
  table: string;
  src_address: string;
  dst_address: string;
  routing_mark: string;
  action: string;
  comment: string;
  disabled: boolean;
}

const emptyRoute: RouteForm = {
  dst_address: '',
  gateway: '',
  distance: '',
  scope: '',
  target_scope: '',
  routing_table: '',
  routing_mark: '',
  comment: '',
  disabled: false,
};

const emptyRule: RuleForm = {
  table: 'main',
  src_address: '',
  dst_address: '',
  routing_mark: '',
  action: 'lookup',
  comment: '',
  disabled: false,
};

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100';

const SendField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block text-sm">
    <span className="text-slate-300">{label}</span>
    {children}
  </label>
);

const Routes: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'routes' | 'rules'>('routes');
  const [search, setSearch] = useState('');
  const [routeForm, setRouteForm] = useState<RouteForm | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceSel = useDeviceSelection();
  const routes = useNet<RouteRow[]>('/api/mikrotik/routes' + deviceSel.query);
  const rules = useNet<RouteRuleRow[]>('/api/mikrotik/route-rules' + deviceSel.query);

  const needle = search.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

  const filteredRoutes = useMemo(
    () =>
      (routes.data ?? []).filter((row) =>
        matches(`${row.dst_address} ${row.gateway} ${row.routing_mark} ${row.comment}`),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes.data, needle],
  );
  const filteredRules = useMemo(
    () =>
      (rules.data ?? []).filter((row) =>
        matches(`${row.table} ${row.src_address} ${row.dst_address} ${row.routing_mark} ${row.comment}`),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules.data, needle],
  );

  const routePager = useTablePager(filteredRoutes, 25);
  const rulePager = useTablePager(filteredRules, 25);

  const saveRoute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!routeForm) return;
    setSaving(true);
    setActionError(null);
    const payload: Record<string, unknown> = {
      dst_address: routeForm.dst_address || undefined,
      gateway: routeForm.gateway || undefined,
      distance: routeForm.distance || undefined,
      scope: routeForm.scope || undefined,
      target_scope: routeForm.target_scope || undefined,
      routing_table: routeForm.routing_table || undefined,
      routing_mark: routeForm.routing_mark || undefined,
      comment: routeForm.comment || undefined,
      disabled: routeForm.disabled,
    };
    try {
      if (routeForm.id) {
        await api.patch(`/api/mikrotik/routes/${encodeURIComponent(routeForm.id)}` + deviceSel.query, payload);
      } else {
        await api.post('/api/mikrotik/routes' + deviceSel.query, payload);
      }
      setRouteForm(null);
      routes.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ruleForm) return;
    setSaving(true);
    setActionError(null);
    const payload: Record<string, unknown> = {
      table: ruleForm.table || undefined,
      src_address: ruleForm.src_address || undefined,
      dst_address: ruleForm.dst_address || undefined,
      routing_mark: ruleForm.routing_mark || undefined,
      action: ruleForm.action || undefined,
      comment: ruleForm.comment || undefined,
      disabled: ruleForm.disabled,
    };
    try {
      if (ruleForm.id) {
        await api.patch(`/api/mikrotik/route-rules/${encodeURIComponent(ruleForm.id)}` + deviceSel.query, payload);
      } else {
        await api.post('/api/mikrotik/route-rules' + deviceSel.query, payload);
      }
      setRuleForm(null);
      rules.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const removeRoute = async (row: RouteRow) => {
    if (!window.confirm(`Hapus route "${row.dst_address}" dari perangkat?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/mikrotik/routes/${encodeURIComponent(row.id)}` + deviceSel.query);
      routes.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const removeRule = async (row: RouteRuleRow) => {
    if (!window.confirm(`Hapus policy rule "${row.src_address || row.dst_address || row.table}" dari perangkat?`)) return;
    setActionError(null);
    try {
      await api.delete(`/api/mikrotik/route-rules/${encodeURIComponent(row.id)}` + deviceSel.query);
      rules.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  return (
    <div>
      <DeviceBar selection={deviceSel} />
      <PageHeader
        title="MikroTik — Routes & Policy"
        subtitle="Tabel routing /ip route (CRUD) dan policy routing /ip route rule (ROS6) atau /routing rule (ROS7)."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StatCard label="Total route" value={formatNumber(routes.data?.length)} />
        <StatCard label="Policy rule" value={formatNumber(rules.data?.length)} />
      </div>

      <Tabs
        tabs={[
          { key: 'routes', label: 'Routes', count: routes.data?.length },
          { key: 'rules', label: 'Policy Rules', count: rules.data?.length },
        ]}
        active={tab}
        onChange={(key) => setTab(key as 'routes' | 'rules')}
      />

      {actionError && <div className="mb-3"><ErrorNote message={actionError} /></div>}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Cari gateway / alamat / mark…" />
        {isAdmin && tab === 'routes' && (
          <Button variant="primary" onClick={() => setRouteForm({ ...emptyRoute })}>+ Tambah route</Button>
        )}
        {isAdmin && tab === 'rules' && (
          <Button variant="primary" onClick={() => setRuleForm({ ...emptyRule })}>+ Tambah policy rule</Button>
        )}
      </Toolbar>

      {tab === 'routes' && (
        <>
          {routes.loading && <Loading />}
          {routes.error && <ErrorNote message={routes.error} onRetry={routes.reload} />}
          {!routes.loading && !routes.error && (
            <>
              <Table
                columns={['Dst address', 'Gateway', 'Distance', 'Mark/Table', 'Komentar', 'Status', 'Tipe', isAdmin ? 'Aksi' : '']}
                isEmpty={filteredRoutes.length === 0}
                empty={search ? 'Tidak ada route yang cocok.' : 'Belum ada route di perangkat.'}
              >
                {routePager.pageRows.map((row) => {
                  const r = row as RouteRow;
                  const mark = r.routing_mark ? `mark:${r.routing_mark}` : r.routing_table ? `table:${r.routing_table}` : '';
                  return (
                    <tr key={r.id} className="hover:bg-slate-700/30">
                      <td className="px-3 py-2 font-mono text-xs text-slate-100">{r.dst_address}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">{r.gateway || '-'}</td>
                      <td className="px-3 py-2 text-slate-400">{r.distance}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{mark || '-'}</td>
                      <td className="px-3 py-2 text-slate-400">{r.comment || '-'}</td>
                      <td className="px-3 py-2">
                        {r.disabled ? <Badge tone="mute">nonaktif</Badge> : r.active ? <Badge tone="good">aktif</Badge> : <Badge tone="warn">tidak aktif</Badge>}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {r.static ? 'static' : r.dynamic ? 'dynamic' : 'connect'}
                      </td>
                      {isAdmin && (
                        <td className="actions">
                          <RowActions
                            label={`Aksi untuk route ${r.dst_address}`}
                            actions={[
                              {
                                key: 'edit',
                                label: 'Ubah route',
                                onSelect: () =>
                                  setRouteForm({
                                    id: r.id,
                                    dst_address: r.dst_address,
                                    gateway: r.gateway,
                                    distance: String(r.distance ?? ''),
                                    scope: r.scope ? String(r.scope) : '',
                                    target_scope: r.target_scope ? String(r.target_scope) : '',
                                    routing_table: r.routing_table,
                                    routing_mark: r.routing_mark,
                                    comment: r.comment,
                                    disabled: r.disabled,
                                  }),
                              },
                              { key: 'delete', label: 'Hapus route', tone: 'danger', onSelect: () => removeRoute(r) },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Table>
              {filteredRoutes.length > 0 && <TablePager unit="route" {...routePager.pagerProps} />}
            </>
          )}
        </>
      )}

      {tab === 'rules' && (
        <>
          {rules.loading && <Loading />}
          {rules.error && <ErrorNote message={rules.error} onRetry={rules.reload} />}
          {!rules.loading && !rules.error && (
            <>
              <Table
                columns={['Src address', 'Dst address', 'Table', 'Routing mark', 'Action', 'Komentar', 'Status', isAdmin ? 'Aksi' : '']}
                isEmpty={filteredRules.length === 0}
                empty={search ? 'Tidak ada policy rule yang cocok.' : 'Belum ada policy rule.'}
              >
                {rulePager.pageRows.map((row) => {
                  const r = row as RouteRuleRow;
                  return (
                    <tr key={r.id} className="hover:bg-slate-700/30">
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">{r.src_address || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">{r.dst_address || '-'}</td>
                      <td className="px-3 py-2 font-medium text-slate-100">{r.table || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.routing_mark || '-'}</td>
                      <td className="px-3 py-2 text-slate-400">{r.action || '-'}</td>
                      <td className="px-3 py-2 text-slate-400">{r.comment || '-'}</td>
                      <td className="px-3 py-2">
                        {r.disabled ? <Badge tone="mute">nonaktif</Badge> : <Badge tone="good">aktif</Badge>}
                      </td>
                      {isAdmin && (
                        <td className="actions">
                          <RowActions
                            label={`Aksi untuk policy rule ${r.table}`}
                            actions={[
                              {
                                key: 'edit',
                                label: 'Ubah rule',
                                onSelect: () =>
                                  setRuleForm({
                                    id: r.id,
                                    table: r.table,
                                    src_address: r.src_address,
                                    dst_address: r.dst_address,
                                    routing_mark: r.routing_mark,
                                    action: r.action,
                                    comment: r.comment,
                                    disabled: r.disabled,
                                  }),
                              },
                              { key: 'delete', label: 'Hapus rule', tone: 'danger', onSelect: () => removeRule(r) },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Table>
              {filteredRules.length > 0 && <TablePager unit="rule" {...rulePager.pagerProps} />}
            </>
          )}
        </>
      )}

      {routeForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={saveRoute} className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {routeForm.id ? 'Ubah route' : 'Tambah route'}
            </h2>
            <div className="space-y-3">
              <SendField label="Dst address">
                <input required value={routeForm.dst_address} onChange={(e) => setRouteForm({ ...routeForm, dst_address: e.target.value })} placeholder="0.0.0.0/0" className={inputCls} />
              </SendField>
              <SendField label="Gateway">
                <input required value={routeForm.gateway} onChange={(e) => setRouteForm({ ...routeForm, gateway: e.target.value })} placeholder="10.0.0.1" className={inputCls} />
              </SendField>
              <div className="grid grid-cols-3 gap-3">
                <SendField label="Distance">
                  <input value={routeForm.distance} onChange={(e) => setRouteForm({ ...routeForm, distance: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Scope">
                  <input value={routeForm.scope} onChange={(e) => setRouteForm({ ...routeForm, scope: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Target scope">
                  <input value={routeForm.target_scope} onChange={(e) => setRouteForm({ ...routeForm, target_scope: e.target.value })} className={inputCls} />
                </SendField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SendField label="Routing table">
                  <input value={routeForm.routing_table} onChange={(e) => setRouteForm({ ...routeForm, routing_table: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Routing mark">
                  <input value={routeForm.routing_mark} onChange={(e) => setRouteForm({ ...routeForm, routing_mark: e.target.value })} className={inputCls} />
                </SendField>
              </div>
              <SendField label="Komentar">
                <input value={routeForm.comment} onChange={(e) => setRouteForm({ ...routeForm, comment: e.target.value })} className={inputCls} />
              </SendField>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={routeForm.disabled} onChange={(e) => setRouteForm({ ...routeForm, disabled: e.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                Nonaktifkan route ini
              </label>
              <InfoNote tone="warn">
                Route menulis langsung ke perangkat. Salah gateway bisa memutus routing produksi.
              </InfoNote>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setRouteForm(null)} disabled={saving}>Batal</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
            </div>
          </form>
        </div>
      )}

      {ruleForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={saveRule} className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {ruleForm.id ? 'Ubah policy rule' : 'Tambah policy rule'}
            </h2>
            <div className="space-y-3">
              <SendField label="Table">
                <input required value={ruleForm.table} onChange={(e) => setRuleForm({ ...ruleForm, table: e.target.value })} placeholder="main" className={inputCls} />
              </SendField>
              <div className="grid grid-cols-2 gap-3">
                <SendField label="Src address">
                  <input value={ruleForm.src_address} onChange={(e) => setRuleForm({ ...ruleForm, src_address: e.target.value })} className={inputCls} />
                </SendField>
                <SendField label="Dst address">
                  <input value={ruleForm.dst_address} onChange={(e) => setRuleForm({ ...ruleForm, dst_address: e.target.value })} className={inputCls} />
                </SendField>
              </div>
              <SendField label="Routing mark (khusus ROS6)">
                <input value={ruleForm.routing_mark} onChange={(e) => setRuleForm({ ...ruleForm, routing_mark: e.target.value })} className={inputCls} />
              </SendField>
              <SendField label="Action">
                <select value={ruleForm.action} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })} className={inputCls}>
                  {['lookup', 'drop', 'unreachable'].map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </SendField>
              <SendField label="Komentar">
                <input value={ruleForm.comment} onChange={(e) => setRuleForm({ ...ruleForm, comment: e.target.value })} className={inputCls} />
              </SendField>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={ruleForm.disabled} onChange={(e) => setRuleForm({ ...ruleForm, disabled: e.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                Nonaktifkan rule ini
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setRuleForm(null)} disabled={saving}>Batal</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Routes;
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import api from '../../services/api';
import { useBackgroundRefresh } from '../../hooks/useBackgroundRefresh';
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
  Table,
  Tabs,
  errorMessage,
  formatNumber,
} from '../../components/net/NetUI';

// Grup RADIUS — satu sumber untuk profil FreeRADIUS dan MikroTik.
//
// Kasus nyata: user hotspot/PPPoE diautentikasi RADIUS, sementara aturan
// kecepatan juga ada di profil MikroTik. Halaman ini menyimpan atribut grup
// di radgroupreply/radgroupcheck dan menampilkan perbandingan langsung dengan
// profil yang benar-benar ada di router (read-only).

interface GroupRow {
  groupname: string;
  users: number;
  rate_limit: string | null;
  session_timeout: string | null;
  simultaneous_use: string | null;
  attributes: number;
}

interface ParityRow {
  name: string;
  status: 'match' | 'mismatch' | 'radius_only' | 'mikrotik_only';
  radius_rate_limit: string | null;
  mikrotik_rate_limit: string | null;
  radius_session_timeout: string | null;
  mikrotik_session_timeout: string | null;
  radius_simultaneous_use: string | null;
  mikrotik_shared_users: string | null;
  radius_users: number | null;
  note: string;
}

interface ParityResponse {
  source: 'hotspot' | 'ppp';
  rows: ParityRow[];
  summary: Record<string, number>;
  error?: string;
}

interface FormState {
  groupname: string;
  rate_limit: string;
  session_timeout: string;
  simultaneous_use: string;
}

const EMPTY_FORM: FormState = {
  groupname: '',
  rate_limit: '',
  session_timeout: '',
  simultaneous_use: '',
};

const STATUS_META: Record<ParityRow['status'], { label: string; tone: 'good' | 'warn' | 'bad' | 'mute' }> = {
  match: { label: 'sama', tone: 'good' },
  mismatch: { label: 'beda', tone: 'warn' },
  radius_only: { label: 'hanya RADIUS', tone: 'mute' },
  mikrotik_only: { label: 'hanya MikroTik', tone: 'bad' },
};

const Grup: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [modal, setModal] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GroupRow | null>(null);

  const [tab, setTab] = useState<'hotspot' | 'ppp'>('hotspot');
  const [parity, setParity] = useState<ParityResponse | null>(null);
  const [parityLoading, setParityLoading] = useState(false);
  const [parityError, setParityError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const { data } = await api.get<GroupRow[]>('/api/freeradius/groups');
      setGroups(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadParity = useCallback(async (source: 'hotspot' | 'ppp') => {
    setParityLoading(true);
    setParityError(null);
    try {
      const { data } = await api.get<ParityResponse>('/api/freeradius/parity', {
        params: { source },
      });
      setParity(data);
      // Galat router dilaporkan terpisah: sisi RADIUS tetap tampil.
      if (data.error) setParityError(`MikroTik tidak terbaca: ${data.error}`);
    } catch (err) {
      setParityError(errorMessage(err));
      setParity(null);
    } finally {
      setParityLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  useEffect(() => {
    void loadParity(tab);
  }, [tab, loadParity]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? groups.filter((g) => g.groupname.toLowerCase().includes(needle)) : groups;
  }, [groups, search]);

  const openCreate = () => setModal({ ...EMPTY_FORM });

  const openEdit = async (row: GroupRow) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.get<{
        reply: Array<{ attribute: string; value: string }>;
        check: Array<{ attribute: string; value: string }>;
      }>(`/api/freeradius/groups/${encodeURIComponent(row.groupname)}`);
      const value = (list: Array<{ attribute: string; value: string }>, attribute: string) =>
        list.find((item) => item.attribute === attribute)?.value ?? '';
      setModal({
        groupname: row.groupname,
        rate_limit: value(data.reply, 'Mikrotik-Rate-Limit'),
        session_timeout: value(data.reply, 'Session-Timeout'),
        simultaneous_use: value(data.check, 'Simultaneous-Use'),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!modal) return;
    setBusy(true);
    setError(null);
    try {
      const reply: Array<{ attribute: string; value: string }> = [];
      const check: Array<{ attribute: string; value: string }> = [];
      if (modal.rate_limit.trim()) {
        reply.push({ attribute: 'Mikrotik-Rate-Limit', value: modal.rate_limit.trim() });
      }
      if (modal.session_timeout.trim()) {
        reply.push({ attribute: 'Session-Timeout', value: modal.session_timeout.trim() });
      }
      if (modal.simultaneous_use.trim()) {
        check.push({ attribute: 'Simultaneous-Use', value: modal.simultaneous_use.trim() });
      }

      await api.post('/api/freeradius/groups', {
        groupname: modal.groupname.trim(),
        reply,
        check,
      });
      setModal(null);
      setToast(`Grup "${modal.groupname.trim()}" disimpan.`);
      await Promise.all([load(), loadParity(tab)]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      // encodeURIComponent: nama grup boleh mengandung titik/strip.
      const { data } = await api.delete<{ removed_users: number }>(
        `/api/freeradius/groups/${encodeURIComponent(confirmDelete.groupname)}`,
      );
      setConfirmDelete(null);
      setToast(
        data.removed_users > 0
          ? `Grup dihapus. ${data.removed_users} user dilepas dari grup ini.`
          : 'Grup dihapus.',
      );
      await Promise.all([load(), loadParity(tab)]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };


  const formInvalid =
    !modal ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(modal.groupname.trim()) ||
    (modal.session_timeout.trim() !== '' && !/^\d+$/.test(modal.session_timeout.trim())) ||
    (modal.simultaneous_use.trim() !== '' && !/^\d+$/.test(modal.simultaneous_use.trim()));

  return (
    <div className="page-container">
      <PageHeader
        title="FreeRADIUS — Grup & Profil"
        subtitle="Atribut grup disimpan di database (radgroupreply/radgroupcheck) lalu dibandingkan dengan profil di MikroTik."
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={openCreate}>
              Tambah grup
            </Button>
          ) : undefined
        }
      />

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {toast}
        </div>
      )}
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Grup RADIUS</p>
          <SearchInput value={search} onChange={setSearch} placeholder="Cari grup…" />
        </div>

        {loading ? (
          <Loading label="Memuat grup…" />
        ) : (
          <Table
            columns={['Nama grup', 'Rate-limit', 'Session', 'Simult.', 'User', isAdmin ? 'Aksi' : '']}
            isEmpty={filtered.length === 0}
            empty={search ? 'Tidak ada grup yang cocok.' : 'Belum ada grup. Tambahkan satu untuk mulai.'}
          >
            {filtered.map((row) => (
              <tr key={row.groupname}>
                <td className="px-3 py-2 font-mono text-xs">{row.groupname}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">
                  {row.rate_limit ?? <span className="text-slate-500">-</span>}
                </td>
                <td className="px-3 py-2 text-xs">{row.session_timeout ?? '-'}</td>
                <td className="px-3 py-2 text-xs">{row.simultaneous_use ?? '-'}</td>
                <td className="px-3 py-2 text-xs">{formatNumber(row.users)}</td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button onClick={() => void openEdit(row)} disabled={busy}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setConfirmDelete(row)} disabled={busy}>
                        Hapus
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Perbandingan dengan profil MikroTik
          </p>
          <Button onClick={() => void loadParity(tab)} disabled={parityLoading}>
            {parityLoading ? 'Memuat…' : 'Hitung ulang'}
          </Button>
        </div>

        <Tabs
          tabs={[
            { key: 'hotspot', label: 'Hotspot (user profile)' },
            { key: 'ppp', label: 'PPP (ppp profile)' },
          ]}
          active={tab}
          onChange={(key) => setTab(key as 'hotspot' | 'ppp')}
        />

        {parityError && (
          <div className="mb-3">
            <InfoNote tone="warn">{parityError}</InfoNote>
          </div>
        )}

        {parityLoading && !parity ? (
          <Loading label="Membandingkan…" />
        ) : parity ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {(['match', 'mismatch', 'radius_only', 'mikrotik_only'] as const).map((key) => (
                <Badge key={key} tone={STATUS_META[key].tone}>
                  {STATUS_META[key].label}: {parity.summary[key] ?? 0}
                </Badge>
              ))}
            </div>

            <Table
              columns={['Nama', 'Status', 'Rate RADIUS', 'Rate MikroTik', 'Catatan']}
              isEmpty={parity.rows.length === 0}
              empty="Tidak ada grup maupun profil untuk dibandingkan."
            >
              {parity.rows.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_META[row.status].tone}>
                      {STATUS_META[row.status].label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">
                    {row.radius_rate_limit ?? '-'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">
                    {row.mikrotik_rate_limit ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">{row.note}</td>
                </tr>
              ))}
            </Table>
          </>
        ) : null}
      </Card>

      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
        >
          <div className="w-full max-w-lg rounded-t-2xl border border-slate-700 bg-slate-900 p-5 sm:rounded-2xl">
            <h3 className="text-base font-semibold text-slate-100">
              {groups.some((g) => g.groupname === modal.groupname) ? 'Ubah grup' : 'Tambah grup'}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Nama grup harus sama dengan profil di MikroTik agar perbandingan bisa cocok.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Nama grup</label>
                <input
                  value={modal.groupname}
                  onChange={(e) => setModal({ ...modal, groupname: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                  placeholder="3000-5h-1d"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Mikrotik-Rate-Limit (rx/tx)
                </label>
                <input
                  value={modal.rate_limit}
                  onChange={(e) => setModal({ ...modal, rate_limit: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                  placeholder="4210K/4520K 4520K/5032K"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Session-Timeout (detik)</label>
                  <input
                    value={modal.session_timeout}
                    onChange={(e) => setModal({ ...modal, session_timeout: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                    placeholder="18000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Simultaneous-Use</label>
                  <input
                    value={modal.simultaneous_use}
                    onChange={(e) => setModal({ ...modal, simultaneous_use: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                    placeholder="1"
                  />
                </div>
              </div>
            </div>

            {formInvalid && (
              <p className="mt-2 text-xs text-amber-300">
                Nama grup wajib (huruf/angka/. _ -), dan angka untuk timeout/simultaneous.
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setModal(null)}>Batal</Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy || formInvalid}>
                {busy ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-slate-100">Hapus grup?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Grup <span className="font-mono">{confirmDelete.groupname}</span> akan dihapus beserta
              atributnya. {confirmDelete.users > 0
                ? `${confirmDelete.users} user akan dilepas dari grup ini (akunnya tetap ada).`
                : 'Belum ada user di grup ini.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirmDelete(null)}>Batal</Button>
              <Button variant="danger" onClick={() => void remove()} disabled={busy}>
                {busy ? 'Menghapus…' : 'Hapus'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Grup;

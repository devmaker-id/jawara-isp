import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Loading,
  PageHeader,
  SearchInput,
  Table,
  errorMessage,
} from '../../components/net/NetUI';

// Bandwidth: satu definisi kecepatan yang dipakai bersama profil hotspot & PPP.
// Nilai disimpan dalam Kbps; UI menerima Mbps lalu dikonversi (1 Mbps = 1000 Kbps).

export interface Bandwidth {
  id: number;
  name: string;
  min_upload_kbps: number;
  min_download_kbps: number;
  max_upload_kbps: number;
  max_download_kbps: number;
  burst_enabled: number;
  burst_upload_kbps: number | null;
  burst_download_kbps: number | null;
  burst_threshold_upload_kbps: number | null;
  burst_threshold_download_kbps: number | null;
  burst_time_sec: number | null;
  priority: number;
}

interface FormState {
  name: string;
  min_up: string;
  min_down: string;
  max_up: string;
  max_down: string;
  burst: boolean;
  burst_up: string;
  burst_down: string;
  thr_up: string;
  thr_down: string;
  burst_time: string;
  priority: string;
}

const EMPTY: FormState = {
  name: '',
  min_up: '0',
  min_down: '0',
  max_up: '',
  max_down: '',
  burst: false,
  burst_up: '',
  burst_down: '',
  thr_up: '',
  thr_down: '',
  burst_time: '8',
  priority: '1',
};

const toKbps = (value: string): number => Math.round(Number(value || 0) * 1000);
const toMbps = (kbps: number): string => (kbps ? String(kbps / 1000) : '');

const Bandwidth: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [rows, setRows] = useState<Bandwidth[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Bandwidth | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Bandwidth[]>('/api/profiles/bandwidth');
      setRows(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, search]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY });
  };

  const openEdit = (row: Bandwidth) => {
    setEditId(row.id);
    setForm({
      name: row.name,
      min_up: toMbps(row.min_upload_kbps),
      min_down: toMbps(row.min_download_kbps),
      max_up: toMbps(row.max_upload_kbps),
      max_down: toMbps(row.max_download_kbps),
      burst: row.burst_enabled === 1,
      burst_up: toMbps(row.burst_upload_kbps ?? 0),
      burst_down: toMbps(row.burst_download_kbps ?? 0),
      thr_up: toMbps(row.burst_threshold_upload_kbps ?? 0),
      thr_down: toMbps(row.burst_threshold_download_kbps ?? 0),
      burst_time: String(row.burst_time_sec ?? 8),
      priority: String(row.priority),
    });
  };

  const invalid =
    !form ||
    form.name.trim() === '' ||
    toKbps(form.max_up) < 1 ||
    toKbps(form.max_down) < 1 ||
    (form.burst && (toKbps(form.burst_up) < 1 || toKbps(form.burst_down) < 1));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      min_upload_kbps: toKbps(form.min_up),
      min_download_kbps: toKbps(form.min_down),
      max_upload_kbps: toKbps(form.max_up),
      max_download_kbps: toKbps(form.max_down),
      burst_enabled: form.burst,
      priority: Number(form.priority),
    };
    if (form.burst) {
      payload.burst_upload_kbps = toKbps(form.burst_up);
      payload.burst_download_kbps = toKbps(form.burst_down);
      payload.burst_threshold_upload_kbps = toKbps(form.thr_up) || undefined;
      payload.burst_threshold_download_kbps = toKbps(form.thr_down) || undefined;
      payload.burst_time_sec = Number(form.burst_time) || 8;
    }
    try {
      if (editId) await api.patch(`/api/profiles/bandwidth/${editId}`, payload);
      else await api.post('/api/profiles/bandwidth', payload);
      setToast(editId ? 'Bandwidth diperbarui.' : 'Bandwidth ditambahkan.');
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
      await api.delete(`/api/profiles/bandwidth/${confirm.id}`);
      setToast('Bandwidth dihapus.');
      setConfirm(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title="Layanan — Bandwidth"
        subtitle="Batas kecepatan yang dipakai bersama profil hotspot dan PPP. Ditulis ke MikroTik dan RADIUS dari satu nilai."
        actions={isAdmin ? <Button variant="primary" onClick={openCreate}>Tambah bandwidth</Button> : undefined}
      />

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {toast}
        </div>
      )}
      {error && <div className="mb-3"><ErrorNote message={error} onRetry={() => void load()} /></div>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Daftar bandwidth</p>
          <SearchInput value={search} onChange={setSearch} placeholder="Cari bandwidth…" />
        </div>

        {loading ? (
          <Loading label="Memuat bandwidth…" />
        ) : (
          <Table
            columns={['Nama', 'Max Up', 'Max Down', 'Min Up/Down', 'Burst', 'Prioritas', isAdmin ? 'Aksi' : '']}
            isEmpty={filtered.length === 0}
            empty={search ? 'Tidak ada yang cocok.' : 'Belum ada bandwidth.'}
          >
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-xs">{row.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.max_upload_kbps} K</td>
                <td className="px-3 py-2 font-mono text-xs">{row.max_download_kbps} K</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {row.min_upload_kbps}/{row.min_download_kbps} K
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.burst_enabled === 1 ? (
                    <Badge tone="good">{row.burst_upload_kbps}/{row.burst_download_kbps} K</Badge>
                  ) : (
                    <span className="text-slate-500">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{row.priority}</td>
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
              {editId ? 'Ubah bandwidth' : 'Tambah bandwidth'}
            </h3>
            <p className="mt-1 text-xs text-slate-400">Nilai dalam Mbps. 1 Mbps = 1000 Kbps.</p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Nama</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  placeholder="10M Up To" />
                <p className="mt-1 text-[11px] text-slate-500">Tidak boleh sama dengan bandwidth lain milik Anda.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Min upload (Mbps)</label>
                  <input type="number" min="0" step="0.1" value={form.min_up}
                    onChange={(e) => setForm({ ...form, min_up: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Min download (Mbps)</label>
                  <input type="number" min="0" step="0.1" value={form.min_down}
                    onChange={(e) => setForm({ ...form, min_down: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Max upload (Mbps) *</label>
                  <input type="number" min="0.1" step="0.1" value={form.max_up}
                    onChange={(e) => setForm({ ...form, max_up: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Max download (Mbps) *</label>
                  <input type="number" min="0.1" step="0.1" value={form.max_down}
                    onChange={(e) => setForm({ ...form, max_down: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={form.burst} onChange={(e) => setForm({ ...form, burst: e.target.checked })} />
                Aktifkan burst
              </label>

              {form.burst && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700/60 p-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Burst up (Mbps)</label>
                    <input type="number" min="0.1" step="0.1" value={form.burst_up}
                      onChange={(e) => setForm({ ...form, burst_up: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Burst down (Mbps)</label>
                    <input type="number" min="0.1" step="0.1" value={form.burst_down}
                      onChange={(e) => setForm({ ...form, burst_down: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Threshold up (Mbps)</label>
                    <input type="number" min="0" step="0.1" value={form.thr_up}
                      onChange={(e) => setForm({ ...form, thr_up: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Threshold down (Mbps)</label>
                    <input type="number" min="0" step="0.1" value={form.thr_down}
                      onChange={(e) => setForm({ ...form, thr_down: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Burst time (detik)</label>
                    <input type="number" min="1" max="60" value={form.burst_time}
                      onChange={(e) => setForm({ ...form, burst_time: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-slate-400">Prioritas (1-8)</label>
                <input type="number" min="1" max="8" value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
            </div>

            {invalid && (
              <p className="mt-2 text-xs text-amber-300">
                Nama dan max upload/download wajib diisi. Min tidak boleh melebihi max.
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
            <h3 className="text-base font-semibold text-slate-100">Hapus bandwidth?</h3>
            <p className="mt-2 text-sm text-slate-300">
              <span className="font-mono">{confirm.name}</span> akan dihapus. Bandwidth yang masih
              dipakai profil tidak bisa dihapus.
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

export default Bandwidth;

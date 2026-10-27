import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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
  SearchInput,
  Table,
  errorMessage,
} from '../../components/net/NetUI';

// Bandwidth: satu definisi kecepatan yang dipakai bersama profil hotspot & PPP.
// Nilai disimpan dalam Kbps; UI menerima Mbps lalu dikonversi (1 Mbps = 1000 Kbps).

export interface Bandwidth {
  id: number;
  owner_id?: number | null;
  owner_name?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
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

type RateUnit = 'mbps' | 'kbps';

interface FormState {
  name: string;
  /** Pemilik data (admin saja). '' = dirinya sendiri. */
  owner_id: string;
  /** Satuan yang dipakai untuk keempat isian kecepatan di form ini. */
  unit: RateUnit;
  min_up: string;
  min_down: string;
  max_up: string;
  max_down: string;
  /** Burst dihitung otomatis 2x max; operator hanya menyalakan/mematikan. */
  burst: boolean;
  priority: string;
}

const EMPTY: FormState = {
  name: '',
  owner_id: '',
  unit: 'mbps',
  min_up: '0',
  min_down: '0',
  max_up: '',
  max_down: '',
  // Default menyala: burst 2x adalah perilaku yang diinginkan untuk paket baru.
  burst: true,
  // 8 = prioritas paling rendah (RouterOS: 1 tertinggi). Paket pelanggan biasa
  // sebaiknya berbagi di antrean terendah, bukan merebut antrean teratas.
  priority: '8',
};

/** Batas kenaikan burst; harus sama dengan BURST_FACTOR di backend. */
const BURST_FACTOR = 2;

const UNIT_FACTOR: Record<RateUnit, number> = { mbps: 1000, kbps: 1 };

/** Isian form → Kbps (disimpan selalu dalam Kbps). */
const toKbps = (value: string, unit: RateUnit): number =>
  Math.round(Number(value || 0) * UNIT_FACTOR[unit]);

/** Kbps → isian form, tanpa nol berekor. */
const fromKbps = (kbps: number, unit: RateUnit): string => {
  if (!kbps) return '';
  const value = kbps / UNIT_FACTOR[unit];
  return String(Math.round(value * 1000) / 1000);
};

/** Teks kecepatan untuk tabel: Mbps bila bulat ribuan, Kbps bila tidak. */
const rateText = (kbps: number): string =>
  !kbps ? '-' : kbps % 1000 === 0 ? `${kbps / 1000} Mbps` : `${kbps} Kbps`;

/** Satuan terbaik untuk menampilkan satu baris: Mbps bila bulat, selain itu Kbps. */
const bestUnit = (values: number[]): RateUnit =>
  values.every((value) => value % 1000 === 0) ? 'mbps' : 'kbps';

const Bandwidth: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [rows, setRows] = useState<Bandwidth[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Bandwidth | null>(null);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
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

  useBackgroundRefresh(load, { intervalMs: 60000 });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, search]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY });
  };

  const openEdit = (row: Bandwidth) => {
    // Tampilkan dalam Mbps kalau semua nilai bulat ribuan, kalau tidak Kbps
    // (mis. paket 512 Kbps tidak boleh tampil sebagai 0,512).
    const unit = bestUnit([
      row.min_upload_kbps,
      row.min_download_kbps,
      row.max_upload_kbps,
      row.max_download_kbps,
    ]);
    setEditId(row.id);
    setForm({
      ...EMPTY,
      name: row.name,
      owner_id: row.owner_id ? String(row.owner_id) : '',
      unit,
      min_up: fromKbps(row.min_upload_kbps, unit),
      min_down: fromKbps(row.min_download_kbps, unit),
      max_up: fromKbps(row.max_upload_kbps, unit),
      max_down: fromKbps(row.max_download_kbps, unit),
      burst: row.burst_enabled === 1,
      priority: String(row.priority),
    });
  };

  const invalid =
    !form ||
    form.name.trim() === '' ||
    toKbps(form.max_up, form.unit) < 1 ||
    toKbps(form.max_down, form.unit) < 1;

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      ...(form.owner_id === 'none'
        ? { owner_id: null }
        : form.owner_id !== ''
          ? { owner_id: Number(form.owner_id) }
          : {}),
      min_upload_kbps: toKbps(form.min_up, form.unit),
      min_download_kbps: toKbps(form.min_down, form.unit),
      max_upload_kbps: toKbps(form.max_up, form.unit),
      max_download_kbps: toKbps(form.max_down, form.unit),
      burst_enabled: form.burst,
      priority: Number(form.priority),
    };
    // Burst TIDAK dikirim: backend menghitungnya 2x max-limit. Mengirim angka
    // sendiri hanya akan diabaikan atau dijepit.
    if (form.burst) {
      payload.burst_time_sec = 8;
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
        title="Profile Group — Bandwidth"
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
            columns={['Nama', 'Max Up', 'Max Down', 'Min Up/Down', 'Burst', 'Prioritas', 'Pemilik', 'Dibuat oleh', isAdmin ? 'Aksi' : '']}
            isEmpty={filtered.length === 0}
            empty={search ? 'Tidak ada yang cocok.' : 'Belum ada bandwidth.'}
          >
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-xs">{row.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{rateText(row.max_upload_kbps)}</td>
                <td className="px-3 py-2 font-mono text-xs">{rateText(row.max_download_kbps)}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {rateText(row.min_upload_kbps)} / {rateText(row.min_download_kbps)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.burst_enabled === 1 ? (
                    <Badge tone="good">
                      {BURST_FACTOR}× max
                    </Badge>
                  ) : (
                    <span className="text-slate-500">mati</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{row.priority}</td>
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
              {editId ? 'Ubah bandwidth' : 'Tambah bandwidth'}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Pilih satuan Mbps atau Kbps; angkanya disimpan dalam Kbps.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Nama</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  placeholder="10M Up To" />
                <p className="mt-1 text-[11px] text-slate-500">Tidak boleh sama dengan bandwidth lain milik Anda.</p>
              </div>

              {!editId && (
                <OwnerSelect
                  value={form.owner_id}
                  onChange={(value) => setForm((f) => (f ? { ...f, owner_id: value } : f))}
                  label="Pemilik bandwidth (admin boleh membuat atas nama akun lain)"
                />
              )}

              <div className="rounded-lg border border-slate-700/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">Satuan kecepatan</span>
                  <div className="flex gap-1 rounded-lg border border-slate-700 p-0.5">
                    {(['mbps', 'kbps'] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => {
                          // Ganti satuan = nilai yang tampil dikonversi, angka Kbps tidak berubah.
                          setForm((f) => {
                            if (!f || f.unit === unit) return f;
                            const convert = (value: string) =>
                              fromKbps(toKbps(value, f.unit), unit);
                            return {
                              ...f,
                              unit,
                              min_up: convert(f.min_up),
                              min_down: convert(f.min_down),
                              max_up: convert(f.max_up),
                              max_down: convert(f.max_down),
                            };
                          });
                        }}
                        className={`rounded px-2 py-1 text-xs font-medium transition ${
                          form.unit === unit
                            ? 'bg-cyan-500/20 text-cyan-200'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {unit === 'mbps' ? 'Mbps' : 'Kbps'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Min upload</label>
                    <input type="number" min="0" step="any" value={form.min_up}
                      onChange={(e) => setForm({ ...form, min_up: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Min download</label>
                    <input type="number" min="0" step="any" value={form.min_down}
                      onChange={(e) => setForm({ ...form, min_down: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Max upload *</label>
                    <input type="number" min="0" step="any" value={form.max_up}
                      onChange={(e) => setForm({ ...form, max_up: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Max download *</label>
                    <input type="number" min="0" step="any" value={form.max_down}
                      onChange={(e) => setForm({ ...form, max_down: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Disimpan selalu dalam Kbps. Contoh: 10 Mbps = 10000 Kbps.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.burst}
                  onChange={(e) => setForm({ ...form, burst: e.target.checked })}
                />
                <span>
                  Burst otomatis (maks {BURST_FACTOR}× max)
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Burst dihitung dari max: {form.burst ? `${BURST_FACTOR}× max-limit` : 'mati'},
                    ambang naik saat pemakaian di bawah max, durasi 8 detik. Tidak bisa melebihi{' '}
                    {BURST_FACTOR}× max.
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Prioritas queue (1 = tertinggi, 8 = terendah)
                </label>
                <input type="number" min="1" max="8" value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100" />
              </div>
            </div>

            {invalid && (
              <p className="mt-2 text-xs text-amber-300">
                Nama dan max upload/download wajib diisi (lebih dari 0 pada satuan yang dipilih).
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

import React, { useState } from 'react';
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
  Table,
  Toolbar,
  errorMessage,
  formatNumber,
  useNet,
} from '../../components/net/NetUI';

interface NasRow {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  server: string | null;
  description: string | null;
  ros_version: '6' | '7';
}

interface NasPage {
  rows: NasRow[];
  total: number;
  page: number | null;
  limit: number | null;
}

interface NasForm {
  id?: number;
  device_id?: number;
  nasname: string;
  shortname: string;
  secret: string;
  type: string;
  description: string;
  ports: number;
  ros_version: '6' | '7';
}

interface Candidate {
  device_id: number;
  name: string;
  host: string;
  identity: string | null;
  registered: boolean;
}

interface CandidatePage {
  server_address: string;
  rows: Candidate[];
}

/** Ringkasan hasil pemeriksaan sebelum NAS disimpan. */
interface SaveResult {
  nasname: string;
  ros_version: string;
  provision: {
    created: boolean;
    updated: boolean;
    address: string;
    service: string;
    incoming_accept: boolean;
    incoming_port: number;
  } | null;
  services: {
    ppp_aaa: { use_radius: boolean; changed: boolean };
    hotspot_profiles: Array<{ name: string; changed: boolean }>;
    hotspot_servers: number;
  } | null;
  coa: { status: string; detail: string; elapsed_ms: number };
  radius_restarted: boolean;
  restart_message?: string;
  preflight: {
    device_name: string;
    version: string;
    nas_address_source: string;
    clock: { date: string; time: string; drift_seconds: number | null };
    reachability: { ok: boolean; detail: string };
  } | null;
}

const emptyForm: NasForm = {
  nasname: '',
  shortname: '',
  secret: '',
  type: 'other',
  description: '',
  ports: 1812,
  ros_version: '6',
};

const Nas: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const nas = useNet<NasPage>('/api/freeradius/nas');
  const candidates = useNet<CandidatePage>('/api/freeradius/nas/candidates');
  const [form, setForm] = useState<NasForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);

  const rows = nas.data?.rows ?? [];
  const available = (candidates.data?.rows ?? []).filter((row) => !row.registered);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setActionError(null);
    setResult(null);
    try {
      if (form.id) {
        const payload: Record<string, unknown> = {
          shortname: form.shortname || undefined,
          type: form.type || undefined,
          description: form.description || undefined,
          ports: form.ports,
          ros_version: form.ros_version,
        };
        if (form.secret) payload.secret = form.secret;
        await api.patch(`/api/freeradius/nas/${form.id}`, payload);
      } else {
        const payload: Record<string, unknown> = {
          shortname: form.shortname || undefined,
          secret: form.secret,
          type: form.type || undefined,
          description: form.description || undefined,
          ports: form.ports,
          ros_version: form.ros_version,
        };
        if (form.device_id) payload.device_id = form.device_id;
        else payload.nasname = form.nasname;
        const response = await api.post<SaveResult>('/api/freeradius/nas', payload);
        setResult(response.data);
        candidates.reload();
      }
      setForm(null);
      nas.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: NasRow) => {
    if (
      !window.confirm(
        `Hapus NAS ${row.nasname}? Panel juga menghapus entri /radius di perangkat. ` +
          'Bila NAS ini masih punya riwayat akuntansi, penghapusan akan ditolak.',
      )
    )
      return;
    setActionError(null);
    try {
      await api.delete(`/api/freeradius/nas/${row.id}`);
      nas.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader
        title="FreeRADIUS — NAS"
        subtitle="Daftar perangkat (biasanya MikroTik) yang diizinkan mengirim permintaan autentikasi ke FreeRADIUS."
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={() => setForm({ ...emptyForm })}>+ Tambah NAS</Button>
          ) : undefined
        }
      />

      {actionError && <div className="mb-3"><ErrorNote message={actionError} /></div>}

      {result && (
        <div className="mb-3">
          <Card>
            <p className="mb-2 text-sm font-semibold text-emerald-400">
              NAS {result.nasname} tersimpan (RouterOS {result.ros_version})
            </p>
            <ul className="space-y-1 text-xs text-slate-300">
              {result.preflight && (
                <>
                  <li>
                    Jam {result.preflight.device_name}: {result.preflight.clock.date}{' '}
                    {result.preflight.clock.time}
                    {result.preflight.clock.drift_seconds !== null && (
                      <> · selisih {Math.abs(result.preflight.clock.drift_seconds)} detik</>
                    )}
                  </li>
                  <li>Jangkauan server: {result.preflight.reachability.detail}</li>
                  <li>Alamat NAS dari: {result.preflight.nas_address_source}</li>
                </>
              )}
              {result.provision && (
                <>
                  <li>
                    Perangkat: /radius {result.provision.created ? 'ditambahkan' : 'diperbarui'} →{' '}
                    {result.provision.address} ({result.provision.service})
                  </li>
                  <li>
                    CoA listener:{' '}
                    {result.provision.incoming_accept
                      ? `aktif di port ${result.provision.incoming_port}`
                      : 'belum aktif'}
                  </li>
                </>
              )}
              {result.services && (
                <>
                  <li>
                    PPP: use-radius {result.services.ppp_aaa.use_radius ? 'aktif' : 'belum aktif'}
                    {result.services.ppp_aaa.changed ? ' (baru diaktifkan)' : ''}
                  </li>
                  <li>
                    Hotspot:{' '}
                    {result.services.hotspot_servers === 0
                      ? 'tidak ada server hotspot di perangkat'
                      : result.services.hotspot_profiles.length === 0
                        ? 'profil hotspot tidak terbaca'
                        : result.services.hotspot_profiles
                            .map((profile) => `${profile.name}${profile.changed ? ' (baru diaktifkan)' : ''}`)
                            .join(', ')}
                  </li>
                </>
              )}
              <li>
                CoA: {result.coa.status} — {result.coa.detail}
              </li>
              <li>
                FreeRADIUS:{' '}
                {result.radius_restarted
                  ? 'restart selesai, daftar client sudah memuat NAS ini'
                  : `restart gagal — ${result.restart_message ?? 'jalankan manual'}`}
              </li>
            </ul>
          </Card>
        </div>
      )}
      {nas.loading && <Loading />}
      {nas.error && <ErrorNote message={nas.error} onRetry={nas.reload} />}

      {!nas.loading && !nas.error && (
        <>
          <Toolbar>
            <span className="text-xs text-slate-500">{formatNumber(nas.data?.total ?? 0)} NAS terdaftar</span>
          </Toolbar>
          <Table
            columns={['Alamat NAS', 'Shortname', 'Tipe', 'Ro.S. Version', 'Port', 'Deskripsi', isAdmin ? 'Aksi' : '']}
            isEmpty={rows.length === 0}
            empty="Belum ada NAS terdaftar. Tambahkan MikroTik Anda agar bisa autentikasi."
          >
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-700/30">
                <td className="px-3 py-2 font-mono text-xs text-slate-100">{row.nasname}</td>
                <td className="px-3 py-2 text-slate-300">{row.shortname ?? '-'}</td>
                <td className="px-3 py-2">
                  <Badge tone="mute">{row.type ?? 'other'}</Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={row.ros_version === '7' ? 'warn' : 'good'}>ROS {row.ros_version}</Badge>
                </td>
                <td className="px-3 py-2 text-slate-400">{row.ports ?? '-'}</td>
                <td className="px-3 py-2 text-slate-400">{row.description || '-'}</td>
                {isAdmin && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="mr-2 text-xs text-cyan-400 hover:underline"
                      onClick={() =>
                        setForm({
                          id: row.id,
                          nasname: row.nasname,
                          shortname: row.shortname ?? '',
                          secret: '',
                          type: row.type ?? 'other',
                          description: row.description ?? '',
                          ports: row.ports ?? 1812,
                          ros_version: row.ros_version ?? '6',
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
        </>
      )}

      <div className="mt-4">
        <Card>
          <p className="text-xs text-slate-400">
            Secret NAS tidak pernah ditampilkan kembali oleh API. Saat mengubah NAS, biarkan kolom secret kosong bila
            tidak ingin mengganti secret. Alamat NAS harus sama dengan IP sumber paket RADIUS dari MikroTik.
          </p>
        </Card>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4">
          <form onSubmit={submit} className="mt-10 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">
              {form.id ? `Ubah NAS ${form.nasname}` : 'Tambah NAS'}
            </h2>

            <div className="space-y-3">
              {!form.id && (
                <label className="block text-sm">
                  <span className="text-slate-300">Perangkat MikroTik</span>
                  <select
                    value={form.device_id ?? ''}
                    onChange={(event) => {
                      const picked = available.find((row) => row.device_id === Number(event.target.value));
                      setForm({
                        ...form,
                        device_id: picked?.device_id,
                        nasname: picked?.host ?? '',
                        shortname: picked?.name ?? form.shortname,
                        type: picked ? 'mikrotik' : form.type,
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  >
                    <option value="">— isi alamat manual —</option>
                    {available.map((row) => (
                      <option key={row.device_id} value={row.device_id}>
                        {row.name} · {row.identity ?? row.host}
                      </option>
                    ))}
                  </select>
                  {available.length === 0 && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Semua perangkat aktif sudah terdaftar sebagai NAS.
                    </span>
                  )}
                </label>
              )}

              <label className="block text-sm">
                <span className="text-slate-300">Alamat NAS (IP / hostname)</span>
                <input
                  required
                  disabled={Boolean(form.id) || Boolean(form.device_id)}
                  value={form.nasname}
                  onChange={(event) => setForm({ ...form, nasname: event.target.value })}
                  placeholder="192.168.100.254"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100 disabled:opacity-60"
                />
                {form.device_id && (
                  <span className="mt-1 block text-xs text-slate-500">
                    Diambil dari IP sumber paket RADIUS perangkat saat disimpan (bisa berbeda dari IP manajemen).
                  </span>
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">Shortname</span>
                  <input
                    value={form.shortname}
                    onChange={(event) => setForm({ ...form, shortname: event.target.value })}
                    placeholder="mikrotik-core"
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Tipe</span>
                  <select
                    value={form.type}
                    onChange={(event) => setForm({ ...form, type: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  >
                    {['other', 'mikrotik', 'cisco', 'freeradius'].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-slate-300">
                  Secret {form.id && <span className="text-xs text-slate-500">(kosongkan bila tidak diubah)</span>}
                </span>
                <input
                  required={!form.id}
                  value={form.secret}
                  onChange={(event) => setForm({ ...form, secret: event.target.value })}
                  placeholder="minimal 8 karakter, sama dengan di MikroTik /radius"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-slate-100"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-300">Port auth</span>
                  <input
                    type="number"
                    value={form.ports}
                    onChange={(event) => setForm({ ...form, ports: Number(event.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Ro.S. Version</span>
                  <select
                    value={form.ros_version}
                    onChange={(event) => setForm({ ...form, ros_version: event.target.value as '6' | '7' })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                  >
                    <option value="6">RouterOS 6 — tanpa Message-Authenticator</option>
                    <option value="7">RouterOS 7 — wajib Message-Authenticator</option>
                  </select>
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-slate-300">Deskripsi</span>
                <input
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-slate-100"
                />
              </label>

              {form.ros_version === '7' ? (
                <InfoNote tone="warn">
                  RouterOS 7.15+ punya opsi <code className="text-slate-200">require-message-auth</code> (default
                  {' '}<code className="text-slate-200">yes-for-request-resp</code>). FreeRADIUS harus mengirim
                  Message-Authenticator pada Access-Accept/Challenge/Reject, kalau tidak login ditolak dengan pesan
                  “received bad Access-Accept”. Di MikroTik pastikan:
                  {'\n'}<code className="text-slate-200">/radius set [find] require-message-auth=yes-for-request-resp</code>
                </InfoNote>
              ) : (
                <InfoNote>
                  RouterOS 6 long-term (6.49.x) sudah membawa opsi <code className="text-slate-200">require-message-auth</code>
                  {' '}— nilai sebenarnya bisa dibaca langsung dari perangkat lewat{' '}
                  <code className="text-slate-200">/radius print</code>. Versi 6 yang lebih lama tidak punya opsi ini,
                  jadi jangan menambahkannya: perintahnya akan ditolak.
                </InfoNote>
              )}

              {form.device_id && (
                <InfoNote>
                  Saat disimpan, panel menulis ke perangkat lewat API: entri{' '}
                  <code className="text-slate-200">/radius</code> (alamat server + secret di atas,
                  service hotspot,ppp), <code className="text-slate-200">/radius incoming accept=yes</code>,
                  serta <code className="text-slate-200">use-radius=yes</code> pada PPP dan profil
                  hotspot yang dipakai. Perangkat harus mengizinkan tulis (write_enabled) dan user
                  API-nya punya policy write.
                </InfoNote>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setForm(null)} disabled={saving}>
                Batal
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Memeriksa & menyimpan…' : 'Simpan'}
              </Button>
            </div>

            {/* Galat harus terlihat di dalam modal: panel di belakangnya tertutup overlay. */}
            {actionError && (
              <div className="mt-3">
                <ErrorNote message={actionError} />
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};

export default Nas;
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { RowActions } from '../../components/table/RowActions';

/**
 * WhatsApp Gateway milik Jawara-ISP.
 *
 * Enam halaman kecil dalam satu berkas: koneksi, keamanan, router perintah,
 * AI, riwayat, monitoring. Semua endpoint admin-only di backend; halaman ini
 * tidak pernah menyimpan token worker maupun kredensial sesi.
 */

const card = 'bg-slate-800/50 rounded-xl border border-slate-700/50 p-5';
const input =
  'w-full px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-100 text-sm outline-none focus:border-cyan-500';
const btn =
  'px-3 py-2 rounded-lg text-sm font-medium bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-60';
const btnGhost =
  'px-3 py-2 rounded-lg text-sm font-medium border border-slate-600 text-slate-200 hover:bg-slate-700/40 disabled:opacity-60';

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
};

const fmt = (value?: string | null) =>
  value ? new Date(value).toLocaleString('id-ID') : '—';

function useEndpoint<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get(path);
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(readError(e, 'Gagal memuat data.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

function Toast({ text }: { text: { tone: 'ok' | 'bad'; text: string } | null }) {
  if (!text) return null;
  return (
    <div
      className={`mb-3 rounded-lg border px-4 py-2 text-sm ${
        text.tone === 'ok'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-red-500/40 bg-red-500/10 text-red-300'
      }`}
    >
      {text.text}
    </div>
  );
}

// ---------------------------------------------------------------- Koneksi
interface StatusPayload {
  worker_online: boolean;
  worker_error: string | null;
  connection: string;
  number: string | null;
  connected_at: string | null;
  qr_available: boolean;
  reconnect_count: number;
  last_error: string | null;
  counters: { messages: number; inbound: number; outbound: number; commands: number; ai: number; failed: number };
}

export const WaConnection: React.FC = () => {
  const { data, error, reload } = useEndpoint<StatusPayload>('/api/whatsapp-gateway/status');
  const [qr, setQr] = useState<{ image: string | null; at: string | null } | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const loadQr = () =>
      api
        .get('/api/whatsapp-gateway/qr')
        .then((res) => {
          if (alive) setQr({ image: res.data.image, at: res.data.at });
        })
        .catch(() => {
          if (alive) setQr(null);
        });

    if (data?.connection === 'connected') {
      setQr(null);
      return () => {
        alive = false;
      };
    }

    void loadQr();
    // Saat pairing (termasuk setelah ganti nomor) status & QR berubah beberapa
    // detik sekali; tanpa polling QR baru tidak pernah tampil sampai halaman
    // dimuat ulang manual.
    const timer = window.setInterval(() => {
      void reload();
      void loadQr();
    }, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [data?.connection, reload]);

  const act = async (path: string, label: string) => {
    setBusy(true);
    try {
      await api.post(path);
      setNote({ tone: 'ok', text: label });
      await reload();
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Aksi gagal.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container space-y-4">
      <Toast text={note} />
      {error && <Toast text={{ tone: 'bad', text: error }} />}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Koneksi WhatsApp</h2>
            <p className="text-xs text-slate-400">Worker terpisah dari backend billing.</p>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => void reload()} disabled={busy}>
              Muat ulang
            </button>
            <button className={btn} onClick={() => act('/api/whatsapp-gateway/connect', 'Perintah sambung dikirim.')} disabled={busy}>
              Sambungkan
            </button>
            <button
              className={btnGhost}
              onClick={() =>
                act(
                  '/api/whatsapp-gateway/repair',
                  'Sesi lama dihapus. Pindai QR baru untuk nomor yang dipakai sekarang.',
                )
              }
              disabled={busy}
              title="Ganti nomor / pairing ulang: sesi lama dihapus lalu QR baru dibuat"
            >
              Pairing ulang
            </button>
            <button
              className={btnGhost}
              onClick={() => act('/api/whatsapp-gateway/logout', 'Sesi dilogout. Pairing ulang diperlukan.')}
              disabled={busy}
            >
              Logout
            </button>
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {[
            ['Status worker', data?.worker_online ? 'aktif' : 'mati'],
            ['Koneksi', data?.connection ?? '—'],
            ['Nomor terhubung', data?.number ?? '—'],
            ['Terhubung sejak', fmt(data?.connected_at)],
            ['Percobaan reconnect', String(data?.reconnect_count ?? 0)],
            ['Catatan terakhir', data?.last_error ?? data?.worker_error ?? '—'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-slate-700/40 pb-1">
              <dt className="text-slate-400">{label}</dt>
              <dd className="text-right text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-white">Pairing / QR</h3>
        {data?.connection === 'connected' ? (
          <p className="mt-2 text-sm text-emerald-300">Sudah tersambung. QR tidak diperlukan.</p>
        ) : qr?.image ? (
          <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <img src={qr.image} alt="QR pairing WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
            <div className="text-xs text-slate-400">
              <p>Buka WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu pindai QR ini.</p>
              <p className="mt-2">Diperbarui: {fmt(qr.at)}</p>
              <p className="mt-2 text-amber-300">QR hanya ditampilkan di sesi admin yang login.</p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            QR belum tersedia. Tunggu beberapa detik lalu tekan Muat ulang.
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Keamanan
interface PolicyPayload {
  policy: { dmPolicy: string; groupPolicy: string; requireMention: boolean; gatewayEnabled: boolean; aiEnabled: boolean };
  values: Record<string, string>;
}
interface AllowRow {
  id: number;
  kind: 'number' | 'group';
  value: string;
  label: string | null;
  is_admin: number;
  is_active: number;
}

export const WaSecurity: React.FC = () => {
  const settings = useEndpoint<PolicyPayload>('/api/whatsapp-gateway/settings');
  const list = useEndpoint<AllowRow[]>('/api/whatsapp-gateway/allowlist');
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [form, setForm] = useState({ kind: 'number' as 'number' | 'group', value: '', label: '', is_admin: false });

  const save = async (key: string, value: string) => {
    try {
      await api.put('/api/whatsapp-gateway/settings', { values: { [key]: value } });
      await settings.reload();
      setNote({ tone: 'ok', text: 'Kebijakan disimpan.' });
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal menyimpan kebijakan.') });
    }
  };

  const add = async () => {
    try {
      await api.post('/api/whatsapp-gateway/allowlist', form);
      setForm({ kind: form.kind, value: '', label: '', is_admin: false });
      await list.reload();
      setNote({ tone: 'ok', text: 'Entri ditambahkan.' });
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal menambah entri.') });
    }
  };

  const toggle = async (row: AllowRow) => {
    try {
      await api.patch(`/api/whatsapp-gateway/allowlist/${row.id}`, { is_active: !row.is_active });
      await list.reload();
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal mengubah entri.') });
    }
  };

  const remove = async (row: AllowRow) => {
    try {
      await api.delete(`/api/whatsapp-gateway/allowlist/${row.id}`);
      await list.reload();
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal menghapus entri.') });
    }
  };

  return (
    <div className="page-container space-y-4">
      <Toast text={note} />
      <div className={card}>
        <h2 className="text-lg font-semibold text-white">Kebijakan Akses</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            ['dm_policy', 'Kebijakan DM', settings.data?.values.dm_policy ?? 'allowlist'],
            ['group_policy', 'Kebijakan grup', settings.data?.values.group_policy ?? 'allowlist'],
          ].map(([key, label, value]) => (
            <label key={key} className="text-sm text-slate-300">
              {label}
              <select className={`${input} mt-1`} value={value} onChange={(e) => void save(key, e.target.value)}>
                <option value="allowlist">allowlist (hanya terdaftar)</option>
                <option value="open">open (semua)</option>
              </select>
            </label>
          ))}
          {[
            ['require_mention', 'Wajib mention di grup'],
            ['gateway_enabled', 'Gateway aktif'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={(settings.data?.values[key] ?? '0') === '1'}
                onChange={(e) => void save(key, e.target.checked ? '1' : '0')}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-white">Allowlist nomor &amp; grup</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'number' | 'group' })}>
            <option value="number">nomor</option>
            <option value="group">grup</option>
          </select>
          <input className={input} placeholder="628xxx atau 1203…@g.us" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          <input className={input} placeholder="label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-300">
              <input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} /> admin
            </label>
            <button className={btn} onClick={() => void add()} disabled={!form.value.trim()}>
              Tambah
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="tbl-compact">
            <thead>
              <tr>
                <th className="py-2">Jenis</th>
                <th className="py-2">Nilai</th>
                <th className="py-2">Label</th>
                <th className="py-2">Admin</th>
                <th className="py-2">Aktif</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="py-2 text-slate-300">{row.kind}</td>
                  <td className="py-2 font-mono text-xs text-slate-100">{row.value}</td>
                  <td className="py-2 text-slate-400">{row.label ?? '—'}</td>
                  <td className="py-2">{row.is_admin ? 'ya' : '—'}</td>
                  <td className="py-2">{row.is_active ? 'ya' : 'tidak'}</td>
                  <td className="py-2 text-right">
                    <RowActions
                      label={`Aksi untuk ${row.value}`}
                      actions={[
                        {
                          key: 'toggle',
                          label: row.is_active ? 'Nonaktifkan' : 'Aktifkan',
                          onSelect: () => void toggle(row),
                        },
                        {
                          key: 'delete',
                          label: 'Hapus entri',
                          tone: 'danger',
                          onSelect: () => void remove(row),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {(list.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    Belum ada entri. Selama allowlist kosong, semua pesan ditolak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Command
export const WaCommands: React.FC = () => {
  const { data } = useEndpoint<{ rows: Array<{ name: string; description: string; admin_only: boolean; usage: string }> }>(
    '/api/whatsapp-gateway/commands',
  );
  return (
    <div className="page-container space-y-4">
      <div className={card}>
        <h2 className="text-lg font-semibold text-white">Command Router</h2>
        <p className="text-xs text-slate-400">
          Dijalankan sebelum AI. Perintah di bawah tidak memanggil model dan tidak memakai token provider.
        </p>
        <table className="tbl-compact mt-4">
          <thead>
            <tr>
              <th className="py-2">Perintah</th>
              <th className="py-2">Keterangan</th>
              <th className="py-2">Akses</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.name}>
                <td className="py-2 font-mono text-xs text-cyan-300">{row.usage}</td>
                <td className="py-2 text-slate-300">{row.description}</td>
                <td className="py-2 text-slate-400">{row.admin_only ? 'administrator' : 'semua pengguna terdaftar'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Riwayat
interface MessageRow {
  id: number;
  direction: 'in' | 'out';
  chat_id: string;
  chat_type: string;
  sender: string | null;
  body_preview: string | null;
  body: string | null;
  processing: string;
  command: string | null;
  reply_status: string;
  error_note: string | null;
  created_at: string;
}

export const WaMessages: React.FC = () => {
  const { data, reload } = useEndpoint<MessageRow[]>('/api/whatsapp-gateway/messages?limit=200');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<MessageRow | null>(null);

  const rows = data ?? [];

  const remove = async (row: MessageRow) => {
    setBusy(true);
    try {
      await api.delete(`/api/whatsapp-gateway/messages/${row.id}`);
      setConfirmId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      setNote({ tone: 'ok', text: 'Baris riwayat dihapus.' });
      await reload();
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal menghapus riwayat.') });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((row) => next.delete(row.id));
      else rows.forEach((row) => next.add(row.id));
      return next;
    });

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await api.post('/api/whatsapp-gateway/messages/delete', { ids: [...selected] });
      const count = selected.size;
      setSelected(new Set());
      setNote({ tone: 'ok', text: `${count} baris riwayat dihapus.` });
      await reload();
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal menghapus riwayat.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container space-y-4">
      <Toast text={note} />
      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Riwayat Pesan</h2>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button
                className="rounded-lg px-3 py-2 text-sm font-medium bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-60"
                onClick={() => void deleteSelected()}
                disabled={busy}
              >
                Hapus terpilih ({selected.size})
              </button>
            )}
            <button className={btnGhost} onClick={() => void reload()}>
              Muat ulang
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Ceklis baris untuk menghapus massal; tombol Detail menampilkan isi pesan penuh.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="tbl-compact">
            <thead>
              <tr>
                <th className="py-2 w-9">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={togglePage}
                    aria-label="Pilih semua baris"
                  />
                </th>
                <th className="py-2">Waktu</th>
                <th className="py-2">Arah</th>
                <th className="py-2">Chat</th>
                <th className="py-2">Pengirim</th>
                <th className="py-2">Proses</th>
                <th className="py-2">Isi</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Pilih baris ${row.id}`}
                    />
                  </td>
                  <td className="py-2 text-xs text-slate-400">{fmt(row.created_at)}</td>
                  <td className="py-2">{row.direction === 'in' ? 'masuk' : 'keluar'}</td>
                  <td className="py-2 text-xs text-slate-300">
                    {row.chat_type} · <span className="font-mono">{row.chat_id}</span>
                  </td>
                  <td className="py-2 text-xs text-slate-400">{row.sender ?? '—'}</td>
                  <td className="py-2 text-xs">
                    <span className="rounded bg-slate-700/60 px-2 py-0.5">{row.processing}</span>
                    {row.command && <span className="ml-1 text-cyan-300">/{row.command}</span>}
                    {row.reply_status === 'failed' && <span className="ml-1 text-red-400">gagal</span>}
                  </td>
                  <td className="py-2 max-w-[340px] truncate text-slate-300" title={row.body_preview ?? ''}>
                    {row.body_preview ?? '—'}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700/40"
                        onClick={() => setDetail(row)}
                      >
                        Detail
                      </button>
                      {confirmId === row.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">Hapus?</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void remove(row)}
                            className="rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-500 disabled:opacity-50"
                          >
                            Ya
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200"
                          >
                            Batal
                          </button>
                        </span>
                      ) : (
                        <RowActions
                          label={`Aksi untuk pesan ${row.id}`}
                          actions={[
                            {
                              key: 'detail',
                              label: 'Lihat detail',
                              onSelect: () => setDetail(row),
                            },
                            {
                              key: 'delete',
                              label: 'Hapus baris riwayat',
                              tone: 'danger',
                              onSelect: () => setConfirmId(row.id),
                            },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-center text-slate-500">
                    Belum ada pesan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-white">Detail Pesan #{detail.id}</h3>
              <button
                type="button"
                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-700/40"
                onClick={() => setDetail(null)}
              >
                ✕
              </button>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Waktu</dt>
                <dd className="text-slate-200">{fmt(detail.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Arah</dt>
                <dd className="text-slate-200">{detail.direction === 'in' ? 'masuk' : 'keluar'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Chat</dt>
                <dd className="text-slate-200">
                  {detail.chat_type} · <span className="font-mono">{detail.chat_id}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Pengirim</dt>
                <dd className="text-slate-200">{detail.sender ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Proses</dt>
                <dd className="text-slate-200">
                  {detail.processing}
                  {detail.command && <span className="ml-1 text-cyan-300">/{detail.command}</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Status balasan</dt>
                <dd className="text-slate-200">{detail.reply_status}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Isi pesan</p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-900/60 p-3 text-sm text-slate-100">
                {detail.body ?? detail.body_preview ?? '—'}
              </pre>
            </div>
            <div className="flex justify-end">
              <button className={btnGhost} onClick={() => setDetail(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Monitor
export const WaMonitor: React.FC = () => {
  const status = useEndpoint<StatusPayload>('/api/whatsapp-gateway/status');
  const monitor = useEndpoint<{
    events: Array<{ id: number; kind: string; message: string; created_at: string }>;
    daily: Array<{ day: string; inbound: number; outbound: number; direct: number; denied: number; errors: number }>;
  }>('/api/whatsapp-gateway/monitor');
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEvent, setConfirmEvent] = useState<number | null>(null);

  const removeEvent = async (id: number) => {
    setBusy(true);
    try {
      await api.delete(`/api/whatsapp-gateway/events/${id}`);
      setConfirmEvent(null);
      setNote({ tone: 'ok', text: 'Catatan log dihapus.' });
      await monitor.reload();
    } catch (e) {
      setNote({ tone: 'bad', text: readError(e, 'Gagal menghapus catatan log.') });
    } finally {
      setBusy(false);
    }
  };

  const counters = status.data?.counters;
  const cards = useMemo(
    () => [
      ['Pesan total', counters?.messages ?? 0],
      ['Masuk', counters?.inbound ?? 0],
      ['Keluar', counters?.outbound ?? 0],
      ['Perintah', counters?.commands ?? 0],
      ['AI', counters?.ai ?? 0],
      ['Gagal kirim', counters?.failed ?? 0],
    ],
    [counters],
  );

  return (
    <div className="page-container space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={String(label)} className={card}>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-semibold text-white">{String(value)}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-white">Kejadian &amp; reconnect</h2>
        <Toast text={note} />
        <ul className="mt-3 space-y-2 text-sm">
          {(monitor.data?.events ?? []).map((event) => (
            <li
              key={event.id}
              className="flex items-center justify-between gap-3 border-b border-slate-700/30 pb-1"
            >
              <span className="min-w-0 flex-1 truncate text-slate-300" title={event.message}>
                {event.message}
              </span>
              <span className="shrink-0 text-xs text-slate-500">{fmt(event.created_at)}</span>
              {confirmEvent === event.id ? (
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEvent(event.id)}
                    className="rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    Ya
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEvent(null)}
                    className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200"
                  >
                    Batal
                  </button>
                </span>
              ) : (
                <RowActions
                  label={`Aksi untuk log ${event.id}`}
                  actions={[
                    {
                      key: 'delete',
                      label: 'Hapus catatan log',
                      tone: 'danger',
                      onSelect: () => setConfirmEvent(event.id),
                    },
                  ]}
                />
              )}
            </li>
          ))}
          {(monitor.data?.events ?? []).length === 0 && <li className="text-slate-500">Belum ada kejadian.</li>}
        </ul>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-white">Aktivitas harian</h3>
        <table className="tbl-compact mt-3">
          <thead>
            <tr>
              <th className="py-2">Tanggal</th>
              <th className="py-2">Masuk</th>
              <th className="py-2">Keluar</th>
              <th className="py-2">Perintah</th>
              <th className="py-2">Ditolak</th>
              <th className="py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {(monitor.data?.daily ?? []).map((row) => (
              <tr key={row.day}>
                <td className="py-2 text-slate-300">{row.day}</td>
                <td className="py-2">{row.inbound ?? 0}</td>
                <td className="py-2">{row.outbound ?? 0}</td>
                <td className="py-2">{row.direct ?? 0}</td>
                <td className="py-2">{row.denied ?? 0}</td>
                <td className="py-2">{row.errors ?? 0}</td>
              </tr>
            ))}
            {(monitor.data?.daily ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  Belum ada aktivitas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import api from '../../services/api';
import { useBackgroundRefresh } from '../../hooks/useBackgroundRefresh';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, Button, Card, ErrorNote, Loading, PageHeader } from '../../components/net/NetUI';
import { TablePager, useTablePager } from '../../components/TablePager';

/**
 * Voucher Management — satu halaman per tipe layanan.
 *
 * Semua aksi massal memakai CENTANG di daftar: yang dipilih hanya itu yang
 * diubah/dihapus/dicetak/dikirim. Bila tidak ada yang dicentang, aksi berlaku
 * pada baris yang sedang tampil (hasil filter), bukan seluruh tabel.
 *
 * Cakupan data dipaksa di server: reseller hanya menerima voucher miliknya,
 * termasuk untuk ekspor dan pengiriman WhatsApp.
 */

type VoucherType = 'hotspot' | 'ppp';
type Status = 'new-created' | 'ready-to-use' | 'active' | 'expired';

interface VoucherRow {
  id: number;
  profile_type: VoucherType;
  profile_id: number;
  profile_name: string;
  user_type: 'voucher' | 'member';
  username: string;
  password: string;
  customer_id: number | null;
  customer_name?: string | null;
  status: Status;
  price: number;
  tax_amount: number;
  first_login_at: string | null;
  expires_at: string | null;
  online_seconds: number;
  quota_used_bytes: number;
  owner_id?: number | null;
  owner_name?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
}

interface ProfileOption {
  id: number;
  name: string;
  owner_id?: number | null;
  owner_name?: string | null;
}

interface OwnerOption {
  id: number;
  name: string;
  email: string;
  role: string;
}

const STATUS_TONE: Record<Status, 'good' | 'warn' | 'bad' | 'mute'> = {
  'new-created': 'mute',
  'ready-to-use': 'warn',
  active: 'good',
  expired: 'bad',
};

const STATUS_LABEL: Record<Status, string> = {
  'new-created': 'baru dibuat',
  'ready-to-use': 'siap pakai',
  active: 'aktif',
  expired: 'kedaluwarsa',
};

const readError = (error: unknown): string => {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return 'Terjadi kesalahan saat menghubungi server.';
};

const inputClass =
  'rounded-lg border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none';

const TITLE: Record<VoucherType, string> = {
  hotspot: 'Voucher Hotspot',
  ppp: 'Voucher PPPoE',
};

const VoucherManagement: React.FC<{ type: VoucherType }> = ({ type }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Endpoint bulk status & hapus dibatasi admin/operator. Tombol yang pasti
  // ditolak server tidak ditampilkan, supaya tidak jadi jebakan.
  const canBulkWrite = isAdmin || user?.role === 'operator';

  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filter
  const [userFilter, setUserFilter] = useState<'all' | 'voucher' | 'member'>('all');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [profileFilter, setProfileFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // Pilihan (centang)
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Dialog
  const [genOpen, setGenOpen] = useState(false);
  const [genProfile, setGenProfile] = useState('');
  const [genCount, setGenCount] = useState('10');
  const [genPrefix, setGenPrefix] = useState('');
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setError(null);
    try {
      const [list, countData, profileList] = await Promise.all([
        api.get<VoucherRow[]>('/api/vouchers', {
          params: {
            limit: 500,
            profile_type: type,
            user_type: userFilter === 'all' ? undefined : userFilter,
            status: statusFilter || undefined,
            profile_id: profileFilter || undefined,
            owner_id: ownerFilter || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            search: search.trim() || undefined,
          },
        }),
        api.get<Record<string, number>>('/api/vouchers/counts'),
        api.get<ProfileOption[]>(`/api/profiles/${type}`),
      ]);
      setRows(Array.isArray(list.data) ? list.data : []);
      setCounts(countData.data ?? {});
      setProfiles(Array.isArray(profileList.data) ? profileList.data : []);
    } catch (err) {
      setError(readError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [type, userFilter, statusFilter, profileFilter, ownerFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  // Daftar pemilik hanya untuk admin; reseller/operator dipaksa server.
  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<OwnerOption[]>('/api/admin/owners')
      .then((res) => setOwners(Array.isArray(res.data) ? res.data : []))
      .catch(() => setOwners([]));
  }, [isAdmin]);

  // Ganti tipe layanan = ganti halaman; filter profil ikut direset.
  useEffect(() => {
    setProfileFilter('');
    setSelected(new Set());
  }, [type]);

  const visible = rows;

  // Voucher bisa ratusan: tampilkan sebagian per halaman. Centang tetap
  // berlaku lintas halaman (disimpan di `selected`), jadi aksi massal tidak
  // terpengaruh pagination.
  const pager = useTablePager(visible, 25);

  const allChecked = visible.length > 0 && visible.every((row) => selected.has(row.id));

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(visible.map((row) => row.id)));
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Id yang jadi sasaran aksi: yang dicentang, atau semua baris yang tampil. */
  const targetIds = useMemo(
    () => (selected.size > 0 ? [...selected] : visible.map((row) => row.id)),
    [selected, visible],
  );

  const flash = (message: string) => {
    setToast(message);
    setError(null);
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      flash(await action());
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const { data } = await api.post<{ created: number; profile: string }>('/api/vouchers/generate', {
        profile_type: type,
        user_type: 'voucher',
        profile_id: Number(genProfile),
        count: Number(genCount),
        username_prefix: genPrefix.trim() || undefined,
      });
      setGenOpen(false);
      setSelected(new Set());
      await load();
      return `${data.created} voucher dibuat untuk profil ${data.profile}.`;
    });

  const activateOne = (row: VoucherRow) =>
    run(async () => {
      await api.post(`/api/vouchers/${row.id}/activate`);
      await load();
      return `Voucher ${row.username} diaktifkan; masa aktif mulai berjalan.`;
    });

  const bulkStatus = (status: Status, label: string) =>
    run(async () => {
      const { data } = await api.patch<{ changed: number }>('/api/vouchers/bulk/status', {
        ids: targetIds,
        status,
      });
      await load();
      return `${data.changed} voucher ditandai ${label}.`;
    });

  const bulkDelete = () =>
    run(async () => {
      const { data } = await api.post<{ removed: number }>('/api/vouchers/remove', {
        ids: targetIds,
      });
      setConfirmDelete(false);
      setSelected(new Set());
      await load();
      return `${data.removed} voucher dihapus beserta akun RADIUS-nya.`;
    });

  const expireOverdue = () =>
    run(async () => {
      const { data } = await api.post<{ expired: number }>('/api/vouchers/expire-overdue');
      await load();
      return `${data.expired} voucher lewat masa aktif ditandai kedaluwarsa.`;
    });

  /** Ambil berkas dari server (butuh Bearer token), lalu unduh atau buka. */
  const fetchFile = async (path: string, filename: string, open: boolean) => {
    const res = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    if (open) {
      const win = window.open(url, '_blank');
      if (!win) {
        setError('Jendela cetak diblokir browser. Izinkan pop-up untuk panel ini.');
        URL.revokeObjectURL(url);
        return;
      }
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
    }
    // Beri waktu viewer memuat blob sebelum dilepas.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const idsQuery = () => (targetIds.length > 0 ? `?ids=${targetIds.join(',')}` : '');

  const printPdf = () =>
    run(async () => {
      await fetchFile(`/api/vouchers/export.pdf${idsQuery()}`, 'voucher.pdf', true);
      return `${targetIds.length} voucher disiapkan untuk dicetak (PDF).`;
    });

  const exportCsv = () =>
    run(async () => {
      await fetchFile(`/api/vouchers/export.csv${idsQuery()}`, `voucher-${type}.csv`, false);
      return `${targetIds.length} voucher diekspor ke CSV.`;
    });

  const sendWhatsApp = () =>
    run(async () => {
      const { data } = await api.post<{
        sent: number;
        skipped: number;
        pdf_attached: boolean;
        note?: string;
        message: string;
      }>('/api/vouchers/send-whatsapp', {
        ids: targetIds,
        phone: waPhone.trim() || undefined,
      });
      setWaOpen(false);
      const extra = data.note ? ` ${data.note}` : '';
      const pdf = data.pdf_attached ? ' PDF dilampirkan.' : ' PDF tidak dilampirkan (lihat catatan).';
      return `${data.message}${pdf}${extra}`;
    });

  const rupiah = (value: number) =>
    new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(value);

  const time = (value: string | null) =>
    value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-';

  return (
    <div className="page-container">
      <PageHeader
        title={TITLE[type]}
        subtitle={
          type === 'hotspot'
            ? 'Voucher hotspot: username = password, masa aktif mulai login pertama.'
            : 'Akun PPPoE: username dan password terpisah, ditulis ke FreeRADIUS.'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button onClick={() => void expireOverdue()} disabled={busy}>
                Tandai kedaluwarsa
              </Button>
            )}
            <Button variant="primary" onClick={() => setGenOpen(true)} disabled={busy}>
              Buat voucher
            </Button>
          </div>
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

      <div className="mb-3 flex flex-wrap gap-2">
        {(['new-created', 'ready-to-use', 'active', 'expired'] as const).map((status) => (
          <Badge key={status} tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}: {counts[status] ?? 0}
          </Badge>
        ))}
      </div>

      <Card>
        {/* Toolbar manajemen: filter + aksi berkas */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-700/60 p-1">
            {(['all', 'voucher', 'member'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setUserFilter(key)}
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  userFilter === key
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {key === 'all' ? 'Semua' : key === 'voucher' ? 'Voucher' : 'Member'}
              </button>
            ))}
          </div>

          <select
            value={profileFilter}
            onChange={(event) => setProfileFilter(event.target.value)}
            className={inputClass}
            title="Filter profil"
          >
            <option value="">Semua profil</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | Status)}
            className={inputClass}
            title="Filter status"
          >
            <option value="">Semua status</option>
            {(['new-created', 'ready-to-use', 'active', 'expired'] as const).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>

          {isAdmin && (
            <select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              className={inputClass}
              title="Filter pemilik"
            >
              <option value="">Semua pemilik</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} ({owner.role})
                </option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={inputClass}
            title="Dibuat sejak tanggal"
          />
          <span className="text-xs text-slate-500">s/d</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className={inputClass}
            title="Dibuat sampai tanggal"
          />

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari username / pelanggan…"
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        {/* Baris aksi: berlaku pada yang dicentang, atau yang tampil bila kosong */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2">
          <span className="text-xs text-slate-400">
            {selected.size > 0
              ? `${selected.size} dipilih`
              : `Belum ada yang dipilih — aksi berlaku pada ${visible.length} baris yang tampil`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canBulkWrite && (
              <>
                <Button onClick={() => void bulkStatus('ready-to-use', 'siap pakai')} disabled={busy || targetIds.length === 0}>
                  Siap pakai
                </Button>
                <Button onClick={() => void bulkStatus('expired', 'kedaluwarsa')} disabled={busy || targetIds.length === 0}>
                  Kedaluwarsa
                </Button>
              </>
            )}
            <Button onClick={() => void exportCsv()} disabled={busy || targetIds.length === 0}>
              Ekspor CSV
            </Button>
            <Button onClick={() => void printPdf()} disabled={busy || targetIds.length === 0}>
              Cetak PDF
            </Button>
            <Button onClick={() => setWaOpen(true)} disabled={busy || targetIds.length === 0}>
              Kirim WhatsApp
            </Button>
            {isAdmin && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy || targetIds.length === 0}>
                Hapus
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <Loading label="Memuat voucher…" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-700/60">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800/80 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Pilih semua"
                      className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-cyan-500"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Password</th>
                  <th className="px-3 py-2 font-medium">Profil</th>
                  <th className="px-3 py-2 font-medium">Pelanggan</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Harga</th>
                  <th className="px-3 py-2 font-medium">Kedaluwarsa</th>
                  <th className="px-3 py-2 font-medium">Pemilik</th>
                  <th className="px-3 py-2 font-medium">Dibuat oleh</th>
                  <th className="px-3 py-2 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60 text-slate-200">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-400">
                      Belum ada voucher yang cocok dengan filter ini.
                    </td>
                  </tr>
                ) : (
                  pager.pageRows.map((row) => (
                    <tr key={row.id} className={selected.has(row.id) ? 'bg-cyan-500/5' : undefined}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleOne(row.id)}
                          aria-label={`Pilih ${row.username}`}
                          className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-cyan-500"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-cyan-200">{row.username}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.password}</td>
                      <td className="px-3 py-2 text-xs">{row.profile_name}</td>
                      <td className="px-3 py-2 text-xs">
                        {row.customer_name ?? <span className="text-slate-500">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {rupiah(Number(row.price) + Number(row.tax_amount))}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">{time(row.expires_at)}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.owner_name ?? <span className="text-slate-500">Tanpa pemilik</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{row.created_by_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {canBulkWrite && row.status !== 'active' && row.status !== 'expired' && (
                            <Button onClick={() => void activateOne(row)} disabled={busy}>
                              Aktifkan
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {visible.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <TablePager unit="voucher" {...pager.pagerProps} />
          </div>
        )}
      </Card>

      {/* Dialog buat voucher */}
      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Buat voucher {type}</h2>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="v-profile">
                Profil *
              </label>
              <select
                id="v-profile"
                value={genProfile}
                onChange={(event) => setGenProfile(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">Pilih profil…</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="v-count">
                  Jumlah (1-200)
                </label>
                <input
                  id="v-count"
                  type="number"
                  min={1}
                  max={200}
                  value={genCount}
                  onChange={(event) => setGenCount(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400" htmlFor="v-prefix">
                  Awalan username
                </label>
                <input
                  id="v-prefix"
                  value={genPrefix}
                  onChange={(event) => setGenPrefix(event.target.value)}
                  placeholder="opsional"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Username dibuat otomatis dan unik. Voucher hotspot: password = username.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setGenOpen(false)}>Batal</Button>
              <Button variant="primary" onClick={() => void generate()} disabled={busy || !genProfile}>
                {busy ? 'Membuat…' : 'Buat'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog kirim WhatsApp */}
      {waOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Kirim voucher via WhatsApp</h2>
            <p className="text-xs text-slate-400">
              {targetIds.length} voucher akan dikirim sebagai PDF. Isi nomor tujuan, atau kosongkan
              untuk memakai nomor pelanggan (khusus akun member).
            </p>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="wa-phone">
                Nomor WhatsApp tujuan
              </label>
              <input
                id="wa-phone"
                value={waPhone}
                onChange={(event) => setWaPhone(event.target.value)}
                placeholder="08123456789"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Gateway diatur di Pengaturan → WhatsApp Bot (Fonnte/Wablas).
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setWaOpen(false)}>Batal</Button>
              <Button variant="primary" onClick={() => void sendWhatsApp()} disabled={busy}>
                {busy ? 'Mengirim…' : 'Kirim'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <h2 className="text-lg font-semibold text-white">Hapus {targetIds.length} voucher?</h2>
            <p className="text-sm text-slate-400">
              Akun RADIUS-nya ikut dicabut sehingga tidak bisa login lagi. Riwayat sesi di radacct
              tetap tersimpan. Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmDelete(false)}>Batal</Button>
              <Button variant="danger" onClick={() => void bulkDelete()} disabled={busy}>
                {busy ? 'Menghapus…' : 'Ya, hapus'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoucherManagement;

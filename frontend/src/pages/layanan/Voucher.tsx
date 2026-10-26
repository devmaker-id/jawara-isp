import React, { useCallback, useEffect, useState } from 'react';
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
  Table,
  Tabs,
  errorMessage,
} from '../../components/net/NetUI';

// Voucher / akun RADIUS.
//
// Dua tipe user:
//   voucher  → akun lepas yang dijual, tanpa pelanggan
//   member   → akun langganan milik satu pelanggan
// Keduanya ditulis ke radcheck (Cleartext-Password) + radusergroup (nama profil).

interface VoucherRow {
  id: number;
  profile_type: 'hotspot' | 'ppp';
  profile_id: number;
  profile_name: string;
  user_type: 'voucher' | 'member';
  username: string;
  password: string;
  customer_id: number | null;
  customer_name?: string | null;
  status: 'new-created' | 'ready-to-use' | 'active' | 'expired';
  price: number;
  tax_amount: number;
  first_login_at: string | null;
  expires_at: string | null;
  online_seconds: number;
  quota_used_bytes: number;
}

interface ProfileOption {
  id: number;
  name: string;
}

interface CustomerOption {
  id: number;
  name: string;
  email: string;
  is_active: number | boolean;
}

const STATUS_TONE: Record<VoucherRow['status'], 'good' | 'warn' | 'bad' | 'mute'> = {
  'new-created': 'mute',
  'ready-to-use': 'warn',
  active: 'good',
  expired: 'bad',
};

const STATUS_LABEL: Record<VoucherRow['status'], string> = {
  'new-created': 'baru dibuat',
  'ready-to-use': 'siap pakai',
  active: 'aktif',
  expired: 'kedaluwarsa',
};

const Voucher: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [profileType, setProfileType] = useState<'hotspot' | 'ppp'>('hotspot');
  const [userFilter, setUserFilter] = useState<'all' | 'voucher' | 'member'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [genOpen, setGenOpen] = useState(false);
  const [genUserType, setGenUserType] = useState<'voucher' | 'member'>('voucher');
  const [genProfile, setGenProfile] = useState('');
  const [genCustomer, setGenCustomer] = useState('');
  const [genCount, setGenCount] = useState('10');
  const [genPrefix, setGenPrefix] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, countData, profileList, customerList] = await Promise.all([
        api.get<VoucherRow[]>('/api/vouchers', {
          params: {
            limit: 500,
            user_type: userFilter === 'all' ? undefined : userFilter,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
          },
        }),
        api.get<Record<string, number>>('/api/vouchers/counts'),
        api.get<ProfileOption[]>(`/api/profiles/${profileType}`),
        api.get<CustomerOption[]>('/api/customers'),
      ]);
      setRows(list.data);
      setCounts(countData.data);
      setProfiles(profileList.data);
      // Hanya pelanggan aktif yang bisa diberi akun.
      setCustomers(customerList.data.filter((row) => Boolean(row.is_active)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [profileType, userFilter, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ created: number; profile: string; total_price: number }>(
        '/api/vouchers/generate',
        {
          profile_type: profileType,
          user_type: genUserType,
          profile_id: Number(genProfile),
          // Customer selalu satu akun: satu pelanggan, satu langganan.
          count: genUserType === 'member' ? 1 : Number(genCount),
          username_prefix: genPrefix.trim() || undefined,
          customer_id: genUserType === 'member' ? Number(genCustomer) : undefined,
        },
      );
      setToast(`${data.created} akun ${genUserType} dibuat untuk ${data.profile}.`);
      setGenOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (row: VoucherRow) => {
    setBusy(true);
    try {
      await api.post(`/api/vouchers/${row.id}/activate`);
      setToast(`Akun ${row.username} diaktifkan; masa aktif mulai berjalan.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const markExpired = async (row: VoucherRow) => {
    setBusy(true);
    try {
      await api.patch(`/api/vouchers/${row.id}/status`, { status: 'expired' });
      setToast(`Akun ${row.username} kedaluwarsa dan dicabut dari RADIUS.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const expireOverdue = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<{ expired: number }>('/api/vouchers/expire-overdue');
      setToast(`${data.expired} akun ditandai kedaluwarsa dan dicabut dari RADIUS.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const filtered = rows.filter((row) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      row.username.toLowerCase().includes(needle) ||
      row.profile_name.toLowerCase().includes(needle) ||
      (row.customer_name ?? '').toLowerCase().includes(needle)
    );
  });

  /**
   * Cetak voucher dari hasil filter yang sedang tampil — bukan seluruh tabel.
   * Membuka jendela baru berisi kartu, lalu memanggil print() di sana supaya
   * layout panel tidak ikut tercetak.
   */
  const printVouchers = () => {
    if (filtered.length === 0) {
      setError('Tidak ada akun untuk dicetak pada filter ini.');
      return;
    }
    const cards = filtered
      .map(
        (row) => `
        <div class="card">
          <div class="net">${row.profile_name}</div>
          <div class="user">${row.username}</div>
          <div class="pass">${row.password}</div>
          <div class="meta">${row.user_type === 'member' ? 'member' : 'voucher'} · ${row.status}</div>
        </div>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Voucher</title>
      <style>
        @page { margin: 8mm; }
        body { font-family: system-ui, sans-serif; margin: 0; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
        .card { border: 1px dashed #444; border-radius: 6px; padding: 4mm; text-align: center; }
        .net { font-size: 9pt; color: #555; margin-bottom: 2mm; }
        .user { font-family: ui-monospace, monospace; font-size: 13pt; font-weight: 700; letter-spacing: .5px; }
        .pass { font-family: ui-monospace, monospace; font-size: 11pt; margin-top: 1mm; }
        .meta { font-size: 8pt; color: #777; margin-top: 2mm; text-transform: uppercase; }
      </style></head><body><div class="grid">${cards}</div></body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      setError('Jendela cetak diblokir browser. Izinkan pop-up untuk panel ini.');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const rupiah = (value: number) =>
    new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <div className="page-container">
      <PageHeader
        title="Layanan — Voucher & Akun"
        subtitle="Akun hotspot/PPP yang ditulis ke FreeRADIUS. Masa aktif dihitung sejak login pertama."
        actions={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void expireOverdue()} disabled={busy}>
                Tandai kedaluwarsa
              </Button>
              <Button variant="primary" onClick={() => setGenOpen(true)} disabled={busy}>
                Buat akun
              </Button>
            </div>
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

      <div className="mb-3 flex flex-wrap gap-2">
        {(['new-created', 'ready-to-use', 'active', 'expired'] as const).map((status) => (
          <Badge key={status} tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}: {counts[status] ?? 0}
          </Badge>
        ))}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            tabs={[
              { key: 'all', label: 'Semua' },
              { key: 'voucher', label: 'Voucher' },
              { key: 'member', label: 'Member' },
            ]}
            active={userFilter}
            onChange={(key) => setUserFilter(key as 'all' | 'voucher' | 'member')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100"
              title="Dibuat sejak tanggal"
            />
            <span className="text-xs text-slate-500">s/d</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100"
              title="Dibuat sampai tanggal"
            />
            <Button onClick={printVouchers}>Cetak ({filtered.length})</Button>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Cari username / pelanggan…"
            />
          </div>
        </div>

        {loading ? (
          <Loading label="Memuat akun…" />
        ) : (
          <Table
            columns={[
              'Username',
              'Password',
              'Tipe',
              'Pelanggan',
              'Profil',
              'Status',
              'Harga',
              'Login pertama',
              'Kedaluwarsa',
              'Online',
              'Kuota',
              isAdmin ? 'Aksi' : '',
            ]}
            isEmpty={filtered.length === 0}
            empty="Belum ada akun."
          >
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono text-xs text-cyan-200">{row.username}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.password}</td>
                <td className="px-3 py-2">
                  <Badge tone={row.user_type === 'member' ? 'good' : 'mute'}>
                    {row.user_type === 'member' ? 'member' : 'voucher'}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.customer_name ?? <span className="text-slate-500">-</span>}
                </td>
                <td className="px-3 py-2 text-xs">{row.profile_name}</td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                </td>
                <td className="px-3 py-2 text-xs">
                  {rupiah(Number(row.price) + Number(row.tax_amount))}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-400">
                  {row.first_login_at ? new Date(row.first_login_at).toLocaleString('id-ID') : '-'}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-400">
                  {row.expires_at ? new Date(row.expires_at).toLocaleString('id-ID') : '-'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {Math.round(Number(row.online_seconds) / 60)} mnt
                </td>
                <td className="px-3 py-2 text-xs">
                  {(Number(row.quota_used_bytes) / 1_000_000_000).toFixed(2)} GB
                </td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.status === 'new-created' || row.status === 'ready-to-use' ? (
                        <Button onClick={() => void activate(row)} disabled={busy}>
                          Aktifkan
                        </Button>
                      ) : null}
                      {row.status !== 'expired' && (
                        <Button
                          variant="danger"
                          onClick={() => void markExpired(row)}
                          disabled={busy}
                        >
                          Expired
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {genOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-slate-100">Buat akun</h3>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Tipe user</label>
                <select
                  value={genUserType}
                  onChange={(e) => setGenUserType(e.target.value as 'voucher' | 'member')}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="voucher">Voucher (tanpa pelanggan)</option>
                  <option value="member">Member (langganan pelanggan)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Tipe profil</label>
                <select
                  value={profileType}
                  onChange={(e) => {
                    setProfileType(e.target.value as 'hotspot' | 'ppp');
                    setGenProfile('');
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="hotspot">Hotspot</option>
                  <option value="ppp">PPP</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Profil</label>
                <select
                  value={genProfile}
                  onChange={(e) => setGenProfile(e.target.value)}
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

              {genUserType === 'member' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Pelanggan *</label>
                  <select
                    value={genCustomer}
                    onChange={(e) => setGenCustomer(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="">Pilih pelanggan…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} ({customer.email})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Satu pelanggan hanya boleh punya satu akun aktif per tipe profil.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    Jumlah {genUserType === 'member' ? '(1 akun)' : '(1-200)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={genUserType === 'member' ? 1 : 200}
                    value={genUserType === 'member' ? '1' : genCount}
                    onChange={(e) => setGenCount(e.target.value)}
                    disabled={genUserType === 'member'}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Awalan (opsional)</label>
                  <input
                    value={genPrefix}
                    onChange={(e) => setGenPrefix(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                    placeholder="HS"
                  />
                </div>
              </div>
            </div>

            {profiles.length === 0 && (
              <div className="mt-3">
                <InfoNote tone="warn">Belum ada profil {profileType}. Buat profil lebih dulu.</InfoNote>
              </div>
            )}
            {genUserType === 'member' && customers.length === 0 && (
              <div className="mt-3">
                <InfoNote tone="warn">
                  Belum ada pelanggan aktif. Tambahkan di menu Pelanggan lebih dulu.
                </InfoNote>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setGenOpen(false)}>Batal</Button>
              <Button
                variant="primary"
                onClick={() => void generate()}
                disabled={
                  busy ||
                  genProfile === '' ||
                  (genUserType === 'member' && genCustomer === '') ||
                  (genUserType === 'voucher' && Number(genCount) < 1)
                }
              >
                {busy ? 'Membuat…' : 'Buat'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Voucher;

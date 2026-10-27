import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import api from '../services/api';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import { useAuth } from '../contexts/AuthContext';
import TablePagination from '../components/TablePagination';

// Halaman pelanggan = pintu masuk layanan. Satu pelanggan langsung memiliki
// akun RADIUS (username, profil hotspot/ppp, limit waktu & kuota), karena
// RADIUS adalah sumber kebenaran untuk siapa yang boleh login.

type CustomerStatus = 'active' | 'expired' | 'suspend' | 'disable';
type ProfileType = 'hotspot' | 'ppp';

interface CustomerAccount {
  id: number;
  username: string;
  password?: string;
  profile_type: ProfileType;
  profile_id: number;
  profile_name: string;
  user_type: string;
  status: string;
  expires_at: string | null;
  online: boolean;
}

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  status: CustomerStatus;
  created_at: string;
  /** Pemilik data. null = data internal (tanpa pemilik). */
  owner_id?: number | null;
  owner_name?: string | null;
  /** Akun yang membuat baris ini (jejak, bukan hak akses). */
  created_by?: number | null;
  created_by_name?: string | null;
  accounts?: CustomerAccount[];
}

interface ProfileOption {
  id: number;
  name: string;
  group_profile_id: number;
  /** Pemilik profil — sumber nilai warisan untuk field pemilik pelanggan. */
  owner_id?: number | null;
  owner_name?: string | null;
  sell_price: number;
  promo_price: number;
  tax_percent: number;
  is_active: number;
  // Limitasi grup (dibaca saja di sini — diubah di halaman Profil).
  quota_type?: 'unlimited' | 'limited';
  timebase_value?: number | null;
  timebase_unit?: string | null;
  quotabase_value?: number | null;
  quotabase_unit?: string | null;
  time_limit_seconds?: number | null;
  quota_limit_bytes?: number | null;
}

/** Ringkasan limitasi sebuah grup/profil, untuk ditampilkan apa adanya. */
const groupLimitText = (profile: ProfileOption | undefined): { time: string; quota: string } => {
  if (!profile) return { time: '-', quota: '-' };
  const unitLabel: Record<string, string> = { minute: 'menit', hour: 'jam', day: 'hari' };
  const time =
    profile.timebase_value && profile.timebase_unit
      ? `${profile.timebase_value} ${unitLabel[profile.timebase_unit] ?? profile.timebase_unit}`
      : formatSeconds(profile.time_limit_seconds ?? null) || 'tanpa batas';
  const quota =
    profile.quotabase_value && profile.quotabase_unit
      ? `${profile.quotabase_value} ${profile.quotabase_unit}`
      : formatBytes(profile.quota_limit_bytes ?? null) || 'tanpa batas';
  return { time, quota };
};

const PAGE_LIMIT = 10;

const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Aktif',
  expired: 'Expired',
  suspend: 'Suspend',
  disable: 'Disable',
};

const STATUS_CLASS: Record<CustomerStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-400',
  expired: 'bg-amber-500/10 text-amber-400',
  suspend: 'bg-orange-500/10 text-orange-400',
  disable: 'bg-slate-500/10 text-slate-400',
};

interface CustomerForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  status: CustomerStatus;
  owner_id: string;
  profile_type: ProfileType;
  profile_id: string;
  username: string;
  password: string;
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  status: 'active',
  owner_id: '',
  profile_type: 'hotspot',
  profile_id: '',
  username: '',
  password: '',
};

type Toast = { type: 'success' | 'error'; text: string } | null;

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatSeconds = (seconds: number | null): string => {
  if (!seconds) return '';
  if (seconds % 86400 === 0) return `${seconds / 86400} hari`;
  if (seconds % 3600 === 0) return `${seconds / 3600} jam`;
  return `${Math.round(seconds / 60)} menit`;
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '';
  if (bytes >= 1_000_000_000) return `${Math.round((bytes / 1_000_000_000) * 10) / 10} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
};

// Ambil pesan dari backend agar pengguna melihat alasan sebenarnya
// (409 email/username duplikat, 400 validasi), bukan pesan generik.
const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

/**
 * Halaman pelanggan. `profileType` membuat halaman ini dipakai tiga kali:
 * semua pelanggan, khusus hotspot, dan khusus PPPoE — CRUD-nya sama.
 */
const Customers: React.FC<{ profileType?: 'hotspot' | 'ppp' }> = ({ profileType }) => {
  const { user } = useAuth();
  const canDelete = user?.role === 'admin';
  const canAssignOwner = user?.role === 'admin';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Pemuatan pertama menampilkan spinner; pemuatan berikutnya berjalan
  // di belakang layar tanpa mengosongkan data yang sudah tampil.
  const loadedOnce = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'' | CustomerStatus>('');
  const [ownerAvailable, setOwnerAvailable] = useState(false);
  const [ownerTarget, setOwnerTarget] = useState<Customer | null>(null);
  const [ownerValue, setOwnerValue] = useState('');
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [resellerOptions, setResellerOptions] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [toast, setToast] = useState<Toast>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Profil layanan untuk dropdown akun, dimuat per tipe agar daftarnya sesuai.
  const [profiles, setProfiles] = useState<Record<ProfileType, ProfileOption[]>>({
    hotspot: [],
    ppp: [],
  });
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [savedAccount, setSavedAccount] = useState<{ username: string; password?: string } | null>(null);

  const [confirmTarget, setConfirmTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    loadedOnce.current = true;
    setLoadError(null);
    try {
      const response = await api.get('/api/customers', {
        params: {
          page,
          limit: PAGE_LIMIT,
          search: debouncedSearch || undefined,
          state: stateFilter || undefined,
          profile: profileType,
        },
      });
      const data = response.data;
      if (Array.isArray(data)) {
        setCustomers(data);
        setTotal(data.length);
      } else {
        setCustomers(Array.isArray(data?.rows) ? data.rows : []);
        setTotal(Number(data?.total ?? 0));
      }
    } catch (error) {
      setCustomers([]);
      setTotal(0);
      setLoadError(readError(error, 'Gagal memuat data pelanggan. Periksa koneksi ke server.'));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, stateFilter, profileType]);

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundRefresh(load, { intervalMs: 60000 });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    api
      .get('/api/customers/meta')
      .then((res) => setOwnerAvailable(Boolean(res.data?.owner_assignment)))
      .catch(() => setOwnerAvailable(false));
  }, []);

  useEffect(() => {
    if (!canAssignOwner || !ownerAvailable) return;
    // Pemilik boleh admin/operator/reseller — bukan hanya reseller, karena
    // operator juga bisa menjadi pemilik data.
    api
      .get('/api/admin/owners')
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : [];
        setResellerOptions(rows);
      })
      .catch(() => setResellerOptions([]));
  }, [canAssignOwner, ownerAvailable]);

  // Profil hanya diambil saat form dibuka: daftar ini bisa panjang.
  const loadProfiles = useCallback(async (type: ProfileType) => {
    setProfilesLoading(true);
    try {
      const { data } = await api.get<ProfileOption[]>(`/api/profiles/${type}`);
      setProfiles((prev) => ({ ...prev, [type]: Array.isArray(data) ? data : [] }));
    } catch {
      setProfiles((prev) => ({ ...prev, [type]: [] }));
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    void loadProfiles(form.profile_type);
  }, [modalOpen, form.profile_type, loadProfiles]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const profileOptions = useMemo(() => profiles[form.profile_type] ?? [], [profiles, form.profile_type]);

  // Pemilik profil yang dipilih — sumber nilai warisan field Pemilik.
  const selectedProfile = useMemo(
    () => profileOptions.find((option) => String(option.id) === form.profile_id),
    [profileOptions, form.profile_id],
  );
  const selectedProfileOwner = selectedProfile?.owner_name ?? null;

  const openCreate = () => {
    setEditing(null);
    // Saat dibuka dari menu Hotspot/PPPoE, tipe akun langsung mengikuti menu.
    setForm({ ...EMPTY_FORM, profile_type: profileType ?? EMPTY_FORM.profile_type });
    setFormError(null);
    setSavedAccount(null);
    setModalOpen(true);
  };

  const openEdit = (customer: Customer) => {
    const account = customer.accounts?.[0];
    setEditing(customer);
    setForm({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address ?? '',
      status: customer.status ?? 'active',
      owner_id: customer.owner_id ? String(customer.owner_id) : '',
      profile_type: account?.profile_type ?? 'hotspot',
      profile_id: account ? String(account.profile_id) : '',
      username: account?.username ?? '',
      // Password tidak pernah dikirim ulang oleh server pada daftar; kosong
      // berarti "jangan diubah".
      password: '',
    });
    setFormError(null);
    setSavedAccount(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setFormError(null);
  };

  const validate = (): string | null => {
    if (form.name.trim().length < 2) return 'Nama minimal 2 karakter.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Format email tidak valid.';
    if (!/^[0-9+\-\s()]{6,20}$/.test(form.phone.trim())) return 'Nomor telepon tidak valid (6-20 digit).';

    // Akun wajib saat membuat pelanggan baru: tanpa akun tidak ada yang bisa login.
    const needsAccount = !editing || (editing.accounts?.length ?? 0) > 0;
    if (needsAccount) {
      if (!form.profile_id) return 'Profil layanan wajib dipilih.';
      if (!editing) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{2,63}$/.test(form.username.trim())) {
          return 'Username 3-64 karakter, huruf/angka/titik/strip/garis bawah/@.';
        }
      }
    }
    return null;
  };

  const buildPayload = () => {
    const needsAccount = !editing || (editing.accounts?.length ?? 0) > 0;
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      status: form.status,
    };
    if (canAssignOwner && ownerAvailable && !editing) {
      // Kepemilikan saat UBAH punya endpoint sendiri (PATCH /:id/owner) yang
      // menulis jejak audit; mengirimnya di sini akan melewati audit itu.
      // Kosong = server mewarisi pemilik dari profil yang dipilih.
      if (form.owner_id === 'none') payload.owner_id = null;
      else if (form.owner_id !== '') payload.owner_id = Number(form.owner_id);
      // '' sengaja tidak dikirim: server mewarisi pemilik dari profil.
    }

    if (needsAccount) {
      payload.account = {
        profile_type: form.profile_type,
        profile_id: Number(form.profile_id),
        ...(editing ? {} : { username: form.username.trim() }),
        ...(form.password.trim() ? { password: form.password.trim() } : {}),
      };
    }
    return payload;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    const payload = buildPayload();

    try {
      if (editing) {
        await api.patch(`/api/customers/${editing.id}`, payload);
        setToast({ type: 'success', text: 'Data pelanggan berhasil diperbarui.' });
        setModalOpen(false);
        setEditing(null);
      } else {
        const { data } = await api.post('/api/customers', payload);
        const account = data?.accounts?.[0];
        // Password hanya diketahui sekali: server tidak mengirimnya lagi.
        if (account?.username) {
          const fromServer = account.password as string | undefined;
          setSavedAccount({
            username: account.username,
            password: fromServer || form.password.trim() || undefined,
          });
        }
        setToast({ type: 'success', text: `Pelanggan "${payload.name}" dibuat beserta akun RADIUS.` });
        setModalOpen(false);
      }
      await load();
    } catch (error) {
      setFormError(readError(error, 'Gagal menyimpan data pelanggan.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/customers/${confirmTarget.id}`);
      setToast({ type: 'success', text: `Pelanggan "${confirmTarget.name}" berhasil dihapus.` });
      setConfirmTarget(null);
      await load();
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menghapus pelanggan.') });
      setConfirmTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const ownerLabel = (id: number | null | undefined): string => {
    if (!id) return 'Belum ditugaskan';
    const found = resellerOptions.find((option) => option.id === Number(id));
    return found ? found.name : `Reseller #${id}`;
  };

  const handleAssignOwner = async () => {
    if (!ownerTarget) return;
    setOwnerSaving(true);
    try {
      const resellerId = ownerValue === '' ? null : Number(ownerValue);
      const response = await api.patch(`/api/customers/${ownerTarget.id}/owner`, {
        owner_id: resellerId,
      });
      const previous = response.data?.previous_owner_id ?? null;
      setToast({
        type: 'success',
        text:
          resellerId === null
            ? `Kepemilikan "${ownerTarget.name}" dilepas (sebelumnya: ${previous ?? 'tanpa pemilik'}).`
            : `Pemilik "${ownerTarget.name}" ditetapkan. Pemilik sebelumnya: ${previous ?? 'tanpa pemilik'}.`,
      });
      setOwnerTarget(null);
      setOwnerValue('');
      await load();
    } catch (error) {
      setToast({ type: 'error', text: readError(error, 'Gagal menetapkan pemilik pelanggan.') });
      setOwnerTarget(null);
    } finally {
      setOwnerSaving(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100';

  const accountOf = (customer: Customer) => customer.accounts?.[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {profileType === 'hotspot'
              ? 'Pelanggan Hotspot'
              : profileType === 'ppp'
                ? 'Pelanggan PPPoE'
                : 'Pelanggan'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {profileType
              ? `Daftar pelanggan dengan akun ${profileType === 'hotspot' ? 'hotspot' : 'PPPoE'}. Satu pelanggan = satu akun RADIUS, profil dan limitasi ditulis ke RADIUS saat disimpan.`
              : 'Satu pelanggan = satu akun RADIUS. Profil, tipe layanan, dan limitasi ditulis ke RADIUS saat disimpan.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Pelanggan
        </button>
      </div>

      {toast && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {toast.text}
          {savedAccount && (
            <div className="mt-2 rounded-lg bg-black/40 p-3 font-mono text-xs text-slate-200">
              <div>username : {savedAccount.username}</div>
              {savedAccount.password && <div>password : {savedAccount.password}</div>}
              <button
                type="button"
                onClick={() => setSavedAccount(null)}
                className="mt-2 text-[11px] text-slate-400 underline"
              >
                simpan dulu, lalu tutup
              </button>
            </div>
          )}
        </div>
      )}

      {!ownerAvailable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Penetapan pemilik belum aktif: kolom <code>customers.owner_id</code> belum ada.
          Menunggu migrasi <code>003_customer_reseller_ownership.sql</code> atau{' '}
          <code>020_owner_and_creator.sql</code>.
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, email, atau telepon..."
          className={inputClass}
          aria-label="Cari pelanggan"
        />
        <select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value as '' | CustomerStatus);
            setPage(1);
          }}
          className={`${inputClass} sm:max-w-[200px]`}
          aria-label="Filter status pelanggan"
        >
          <option value="">Semua status</option>
          <option value="active">Aktif</option>
          <option value="expired">Expired</option>
          <option value="suspend">Suspend</option>
          <option value="disable">Disable</option>
        </select>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-700/40 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-red-400">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
            >
              Coba lagi
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-slate-300 font-medium">
              {debouncedSearch || stateFilter ? 'Tidak ada hasil' : 'Belum ada pelanggan'}
            </p>
            <p className="text-sm text-slate-500">
              {debouncedSearch || stateFilter
                ? 'Coba kata kunci lain atau ubah filter status.'
                : 'Tambahkan pelanggan pertama untuk mulai mengelola layanan.'}
            </p>
            {!debouncedSearch && !stateFilter && (
              <button
                type="button"
                onClick={openCreate}
                className="mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 transition"
              >
                Tambah Pelanggan
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700/50 bg-slate-700/30">
                    <th className="px-4 py-3 font-medium">Nama</th>
                    <th className="px-4 py-3 font-medium">Kontak</th>
                    <th className="px-4 py-3 font-medium">Akun RADIUS</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Pemilik</th>
                    <th className="px-4 py-3 font-medium">Dibuat oleh</th>
                    <th className="px-4 py-3 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {customers.map((customer) => {
                    const account = accountOf(customer);
                    const status = (customer.status ?? 'active') as CustomerStatus;
                    return (
                      <tr key={customer.id} className="hover:bg-slate-700/20 transition">
                        <td className="px-4 py-3">
                          <div className="font-medium text-white">{customer.name}</div>
                          {customer.address && (
                            <div className="text-xs text-slate-500 truncate max-w-[220px]">{customer.address}</div>
                          )}
                          <div className="text-[11px] text-slate-600">
                            sejak {formatDate(customer.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          <div className="text-xs">{customer.email}</div>
                          <div className="text-xs text-slate-500">{customer.phone}</div>
                        </td>
                        <td className="px-4 py-3">
                          {account ? (
                            <div className="leading-tight">
                              <div>
                                <span className="font-mono text-xs text-slate-200">{account.username}</span>
                                {account.online && (
                                  <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-400">
                                    online
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {account.profile_type} · {account.profile_name}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-400">belum punya akun</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[status]}`}
                          >
                            {STATUS_LABEL[status]}
                          </span>
                        </td>
                        {ownerAvailable && (
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {customer.owner_name ?? ownerLabel(customer.owner_id) ? (
                              customer.owner_name ?? ownerLabel(customer.owner_id)
                            ) : (
                              <span className="text-slate-500">Tanpa pemilik</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {customer.created_by_name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEdit(customer)}
                            className="text-cyan-400 hover:text-cyan-300 transition mr-3"
                          >
                            Ubah
                          </button>
                          {canAssignOwner && ownerAvailable && (
                            <button
                              type="button"
                              onClick={() => {
                                setOwnerTarget(customer);
                                setOwnerValue(customer.owner_id ? String(customer.owner_id) : '');
                              }}
                              className="text-amber-300 hover:text-amber-200 transition mr-3"
                            >
                              Pemilik
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setConfirmTarget(customer)}
                              className="text-red-400 hover:text-red-300 transition"
                            >
                              Hapus
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-slate-700/50">
              {customers.map((customer) => {
                const account = accountOf(customer);
                const status = (customer.status ?? 'active') as CustomerStatus;
                return (
                  <div key={customer.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">{customer.name}</p>
                        <p className="text-xs text-slate-400 truncate">{customer.email}</p>
                        <p className="text-xs text-slate-400">{customer.phone}</p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {account ? (
                        <>
                          <span className="font-mono text-slate-200">{account.username}</span>
                          <span className="text-slate-500"> · {account.profile_type}/{account.profile_name}</span>
                        </>
                      ) : (
                        <span className="text-amber-400">belum punya akun</span>
                      )}
                    </div>
                    {customer.address && <p className="text-xs text-slate-500 break-words">{customer.address}</p>}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-slate-500">{formatDate(customer.created_at)}</span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(customer)}
                          className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition"
                        >
                          Ubah
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(customer)}
                            className="text-xs font-medium text-red-400 hover:text-red-300 transition"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {!loadError && (
        <TablePagination
          page={page}
          total={total}
          limit={PAGE_LIMIT}
          loading={loading}
          unit="pelanggan"
          onPage={setPage}
        />
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-modal-title"
            className="w-full sm:max-w-xl bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl max-h-[92vh] overflow-y-auto"
          >
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 id="customer-modal-title" className="text-lg font-semibold text-white">
                  {editing ? 'Ubah Pelanggan' : 'Tambah Pelanggan'}
                </h2>
                <button
                  type="button"
                  onClick={closeModal}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition"
                  aria-label="Tutup"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-name">
                    Nama Lengkap *
                  </label>
                  <input
                    id="c-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass}
                    placeholder="Nama pelanggan"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-email">
                    Email *
                  </label>
                  <input
                    id="c-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className={inputClass}
                    placeholder="nama@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-phone">
                    No. Telepon *
                  </label>
                  <input
                    id="c-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className={inputClass}
                    placeholder="08xxxxxxxxxx"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-address">
                    Alamat
                  </label>
                  <textarea
                    id="c-address"
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    rows={2}
                    className={`${inputClass} resize-y`}
                    placeholder="Alamat lengkap"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-status">
                    Status pelanggan *
                  </label>
                  <select
                    id="c-status"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CustomerStatus }))}
                    className={inputClass}
                  >
                    <option value="active">Aktif — boleh login</option>
                    <option value="expired">Expired — akun kedaluwarsa</option>
                    <option value="suspend">Suspend — ditolak sementara</option>
                    <option value="disable">Disable — ditolak permanen</option>
                  </select>
                </div>

                {!editing && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="c-owner">
                      Pemilik
                    </label>
                    {canAssignOwner ? (
                      <>
                        <select
                          id="c-owner"
                          value={form.owner_id}
                          onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="">— Ikut pemilik profil —</option>
                          <option value="none">— Tanpa pemilik (internal) —</option>
                          {resellerOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name} — {option.email} ({option.role})
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-slate-500 mt-1">
                          {selectedProfileOwner
                            ? `Otomatis terisi dari profil: ${selectedProfileOwner}. Boleh diganti.`
                            : 'Pemilik profil ini belum ditetapkan. Pilih sendiri atau biarkan internal.'}
                        </p>
                      </>
                    ) : (
                      <p className="px-3 py-2 rounded-lg bg-slate-700/40 border border-slate-600/60 text-sm text-slate-300">
                        {selectedProfileOwner ?? user?.name ?? 'Akun Anda'} — otomatis, tidak dapat diubah.
                      </p>
                    )}
                  </div>
                )}

                {editing && ownerAvailable && (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] text-slate-500">
                      Pemilik saat ini: <span className="text-slate-300">{ownerLabel(editing.owner_id)}</span>.
                      Mengubah pemilik lewat tombol <span className="text-amber-300">Pemilik</span> di tabel
                      agar perubahan tercatat di audit.
                    </p>
                  </div>
                )}
              </div>

              {(!editing || (editing.accounts?.length ?? 0) > 0) ? (
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">Akun RADIUS</p>
                    <p className="text-[11px] text-slate-500">
                      Profil menentukan grup RADIUS (bandwidth, pool, parent queue). Limitasi di bawah
                      ditulis per user ke <code>radreply</code>, jadi tidak menular ke pelanggan lain.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1" htmlFor="c-type">
                        Tipe layanan *
                      </label>
                      <select
                        id="c-type"
                        value={form.profile_type}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            profile_type: e.target.value as ProfileType,
                            // Profil lama tidak berlaku untuk tipe lain.
                            profile_id: '',
                          }))
                        }
                        className={inputClass}
                      >
                        <option value="hotspot">HOTSPOT</option>
                        <option value="ppp">PPPoE</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1" htmlFor="c-profile">
                        Profil {form.profile_type} *
                      </label>
                      <select
                        id="c-profile"
                        value={form.profile_id}
                        onChange={(e) => {
                          const value = e.target.value;
                          const picked = profileOptions.find((option) => String(option.id) === value);
                          setForm((f) => ({
                            ...f,
                            profile_id: value,
                            // Warisi pemilik dari profil; admin masih bisa
                            // menggantinya sesudah ini.
                            owner_id: picked?.owner_id ? String(picked.owner_id) : '',
                          }));
                        }}
                        className={inputClass}
                      >
                        <option value="">
                          {profilesLoading ? 'Memuat profil…' : profileOptions.length ? 'Pilih profil…' : 'Belum ada profil'}
                        </option>
                        {profileOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                            {option.is_active === 0 ? ' (nonaktif)' : ''}
                          </option>
                        ))}
                      </select>
                      {!profilesLoading && profileOptions.length === 0 && (
                        <p className="text-[11px] text-amber-400 mt-1">
                          Buat profil {form.profile_type} dulu di Profile Group → Profil{' '}
                          {form.profile_type === 'hotspot' ? 'Hotspot' : 'PPP'}.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1" htmlFor="c-username">
                        Username *
                      </label>
                      <input
                        id="c-username"
                        type="text"
                        value={form.username}
                        onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        className={`${inputClass} font-mono`}
                        placeholder="mis. munji01"
                        // Username adalah identitas login dan kunci riwayat radacct.
                        disabled={Boolean(editing)}
                        required={!editing}
                      />
                      {editing && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Username tidak bisa diubah. Ganti = buat akun baru.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1" htmlFor="c-password">
                        Password {editing ? '(kosong = tidak diubah)' : '(kosong = dibuat otomatis)'}
                      </label>
                      <input
                        id="c-password"
                        type="text"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        className={`${inputClass} font-mono`}
                        placeholder="min. 4 karakter / biarkan kosong"
                        autoComplete="off"
                      />
                    </div>

                    <div className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                      <p className="text-xs font-semibold text-slate-300">Limitasi grup</p>
                      <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-400">
                        <div>batas waktu : {groupLimitText(profileOptions.find((p) => String(p.id) === form.profile_id)).time}</div>
                        <div>batas kuota : {groupLimitText(profileOptions.find((p) => String(p.id) === form.profile_id)).quota}</div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Batas waktu dan kuota melekat pada grup (profil layanan) dan berlaku untuk semua
                        pelanggan di dalamnya. Ubah di Profile Group → Profil{' '}
                        {form.profile_type === 'hotspot' ? 'Hotspot' : 'PPP'}.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Pelanggan ini belum punya akun RADIUS, jadi tidak ada profil yang bisa diubah di sini.
                  Data kontak tetap bisa disunting.
                </p>
              )}

              {formError && (
                <p role="alert" className="text-sm text-red-400">
                  {formError}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
                >
                  {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ownerTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-title"
            className="w-full max-w-md bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <h2 id="owner-title" className="text-lg font-semibold text-white">
              Tetapkan pemilik pelanggan
            </h2>
            <p className="text-sm text-slate-400">
              <span className="text-slate-200 font-medium">{ownerTarget.name}</span> — pemilik saat ini:{' '}
              {ownerLabel(ownerTarget.owner_id)}
            </p>
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="owner-select">
                Reseller
              </label>
              <select
                id="owner-select"
                value={ownerValue}
                onChange={(e) => setOwnerValue(e.target.value)}
                className={inputClass}
              >
                <option value="">— Lepas kepemilikan (tanpa reseller) —</option>
                {resellerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-2">
                Melepas kepemilikan membuat pelanggan hanya terlihat oleh admin/operator. Tagihan,
                pembayaran, dan layanan tidak diubah.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setOwnerTarget(null)}
                disabled={ownerSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleAssignOwner()}
                disabled={ownerSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
              >
                {ownerSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-sm bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <h2 id="confirm-title" className="text-lg font-semibold text-white">
              Hapus pelanggan?
            </h2>
            <p className="text-sm text-slate-400">
              Data <span className="text-slate-200 font-medium">{confirmTarget.name}</span> akan dihapus permanen.
            </p>
            <p className="text-xs text-slate-500">
              Akun RADIUS-nya ikut dicabut dari <code>radcheck</code>, <code>radreply</code>, dan{' '}
              <code>radusergroup</code> sehingga tidak bisa login lagi. Pelanggan yang sudah punya tagihan
              ditolak server (409) — nonaktifkan saja agar riwayat tetap tersimpan.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-400 disabled:opacity-50 transition"
              >
                {deleting ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;

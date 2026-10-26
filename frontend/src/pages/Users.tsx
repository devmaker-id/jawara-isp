import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

type Role = 'admin' | 'operator' | 'resseler';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface UserPage {
  rows: UserRow[];
  total: number;
  page: number;
  limit: number;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  // Nilai enum di database adalah 'resseler' (satu "s"); label UI memakai
  // ejaan baku tanpa mengubah data.
  resseler: 'Reseller',
};

const MIN_PASSWORD = 8;
const PAGE_SIZE = 10;

const readError = (error: unknown, fallback: string): string => {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
};

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100 text-sm';

const emptyForm = {
  name: '',
  email: '',
  role: 'operator' as Role,
  is_active: true,
  password: '',
};

const Users: React.FC = () => {
  const currentUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? Number(JSON.parse(raw)?.id ?? 0) : 0;
    } catch {
      return 0;
    }
  }, []);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [passwordTarget, setPasswordTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<{ user: UserRow; nextState: boolean } | null>(null);

  // Status fitur kepemilikan pelanggan, dibaca dari server (bukan teks tetap),
  // supaya pemberitahuan hilang sendiri setelah migrasi 003 dijalankan.
  const [ownerAssignment, setOwnerAssignment] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/api/admin/users', {
        params: { page, limit: PAGE_SIZE, search: search || undefined, role: roleFilter || undefined, status: statusFilter || undefined },
      });
      const data = res.data as UserPage;
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      setRows([]);
      setTotal(0);
      setLoadError(readError(error, 'Gagal memuat daftar pengguna.'));
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ owner_assignment: boolean }>('/api/customers/meta')
      .then((res) => setOwnerAssignment(Boolean(res.data.owner_assignment)))
      .catch(() => setOwnerAssignment(null));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (user: UserRow) => {
    setEditing(user);
    setForm({ name: user.name, email: user.email, role: user.role, is_active: user.is_active, password: '' });
    setFormError(null);
    setFormOpen(true);
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name) return setFormError('Nama lengkap wajib diisi.');
    if (!email) return setFormError('Email wajib diisi karena dipakai sebagai identitas login.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setFormError('Format email tidak valid.');
    if (!editing && form.password.length < MIN_PASSWORD) {
      return setFormError(`Kata sandi minimal ${MIN_PASSWORD} karakter.`);
    }
    if (editing && form.password && form.password.length < MIN_PASSWORD) {
      return setFormError(`Kata sandi minimal ${MIN_PASSWORD} karakter.`);
    }

    setSaving(true);
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          name,
          email,
          role: form.role,
          is_active: form.is_active,
        };
        if (form.password) payload.password = form.password;
        await api.patch(`/api/admin/users/${editing.id}`, payload);
        setNotice({ kind: 'ok', text: `Pengguna ${name} diperbarui.` });
      } else {
        await api.post('/api/admin/users', {
          name,
          email,
          password: form.password,
          role: form.role,
          is_active: form.is_active,
        });
        setNotice({
          kind: 'ok',
          text: `Pengguna ${name} dibuat. Sampaikan kata sandi awal secara langsung kepada pemilik akun.`,
        });
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      setFormError(readError(error, 'Gagal menyimpan pengguna.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!confirmTarget) return;
    const { user, nextState } = confirmTarget;
    setConfirmTarget(null);
    try {
      await api.patch(`/api/admin/users/${user.id}`, { is_active: nextState });
      setNotice({
        kind: 'ok',
        text: `Akun ${user.email} ${nextState ? 'diaktifkan' : 'dinonaktifkan'}.`,
      });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: readError(error, 'Gagal mengubah status akun.') });
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordTarget) return;
    if (newPassword.length < MIN_PASSWORD) {
      setNotice({ kind: 'error', text: `Kata sandi minimal ${MIN_PASSWORD} karakter.` });
      return;
    }
    try {
      await api.patch(`/api/admin/users/${passwordTarget.id}`, { password: newPassword });
      setNotice({
        kind: 'ok',
        text: `Kata sandi ${passwordTarget.email} diganti. Belum ada email otomatis — sampaikan manual.`,
      });
      setPasswordTarget(null);
      setNewPassword('');
    } catch (error) {
      setNotice({ kind: 'error', text: readError(error, 'Gagal mengganti kata sandi.') });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pengguna</h1>
          <p className="text-slate-400 text-sm mt-1">
            Akun login panel: admin, operator, dan reseller
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 transition"
        >
          Tambah Pengguna
        </button>
      </div>

      <div className="rounded-xl border border-slate-500/30 bg-slate-500/10 px-4 py-3 text-xs text-slate-300">
        <p>
          Login memakai <code>email</code> sebagai identitas (tanpa username).{' '}
          {ownerAssignment === null ? (
            'Status penautan pelanggan ke reseller belum dapat dibaca.'
          ) : ownerAssignment ? (
            <>
              Penautan pelanggan ke reseller sudah aktif: reseller hanya melihat pelanggan yang
              ditugaskan kepadanya, sedangkan admin/operator melihat seluruh data.
            </>
          ) : (
            <>
              Penautan pelanggan ke reseller belum aktif — menunggu migrasi{' '}
              <code>003_customer_reseller_ownership.sql</code>; selama itu pembatasan data per
              reseller belum diberlakukan.
            </>
          )}
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            notice.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border border-red-500/30'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="u-search">
            Cari nama atau email
          </label>
          <input
            id="u-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="mis. budi atau budi@contoh.id"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="u-role">
            Role
          </label>
          <select
            id="u-role"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as '' | Role);
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="">Semua</option>
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
            <option value="resseler">Reseller</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1" htmlFor="u-status">
            Status
          </label>
          <select
            id="u-status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as '' | 'active' | 'inactive');
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="">Semua</option>
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
          </select>
        </div>
      </div>

      {loadError ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center space-y-3">
          <p className="text-sm text-amber-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/30">
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Nama</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Email (login)</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-400">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Memuat data…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Tidak ada pengguna yang cocok dengan filter.
                    </td>
                  </tr>
                ) : (
                  rows.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-700/20 transition">
                      <td className="px-4 py-3 text-slate-200">
                        {user.name}
                        {user.id === currentUserId && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-cyan-400">
                            Anda
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-full text-xs bg-slate-700/60 text-slate-200">
                          {ROLE_LABEL[user.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            user.is_active
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-slate-600/30 text-slate-400'
                          }`}
                        >
                          {user.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            className="px-2.5 py-1.5 rounded-lg text-xs text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPasswordTarget(user);
                              setNewPassword('');
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs text-slate-200 bg-slate-700/50 hover:bg-slate-700 transition"
                          >
                            Reset sandi
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmTarget({ user, nextState: !user.is_active })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs transition ${
                              user.is_active
                                ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'
                                : 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                            }`}
                          >
                            {user.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-slate-700/30 text-sm text-slate-400">
            <span>
              Menampilkan {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, total)} dari {total} pengguna
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
              >
                Sebelumnya
              </button>
              <span className="text-xs">
                Halaman {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'Edit pengguna' : 'Tambah pengguna'}
            onSubmit={submitForm}
            className="w-full max-w-lg rounded-xl bg-slate-800 border border-slate-700 p-5 space-y-4"
          >
            <h2 className="text-lg font-semibold text-white">
              {editing ? `Edit ${editing.email}` : 'Tambah pengguna'}
            </h2>

            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="f-name">
                Nama lengkap
              </label>
              <input
                id="f-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
                maxLength={100}
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="f-email">
                Email (dipakai untuk login)
              </label>
              <input
                id="f-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
                maxLength={100}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1" htmlFor="f-role">
                  Role
                </label>
                <select
                  id="f-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                  className={inputClass}
                  disabled={editing?.id === currentUserId}
                >
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                  <option value="resseler">Reseller</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1" htmlFor="f-status">
                  Status
                </label>
                <select
                  id="f-status"
                  value={form.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })}
                  className={inputClass}
                  disabled={editing?.id === currentUserId}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>
            </div>

            {form.role === 'resseler' && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                Identitas reseller belum bisa dihubungkan: belum ada relasi reseller–pelanggan di
                skema. Akun reseller dibuat tanpa cakupan data.
              </p>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="f-password">
                {editing ? 'Kata sandi baru (kosongkan bila tidak diubah)' : 'Kata sandi awal'}
              </label>
              <input
                id="f-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={inputClass}
                placeholder={`minimal ${MIN_PASSWORD} karakter`}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Disimpan sebagai hash (bcrypt). Tidak ada email undangan otomatis — sampaikan
                langsung kepada pemilik akun dan minta segera diganti.
              </p>
            </div>

            {formError && <p className="text-sm text-red-300">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-3 py-2 rounded-lg text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 transition"
              >
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Reset kata sandi"
            onSubmit={submitPassword}
            className="w-full max-w-md rounded-xl bg-slate-800 border border-slate-700 p-5 space-y-4"
          >
            <h2 className="text-lg font-semibold text-white">Reset kata sandi</h2>
            <p className="text-sm text-slate-400">{passwordTarget.email}</p>
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="f-new-password">
                Kata sandi baru
              </label>
              <input
                id="f-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasswordTarget(null)}
                className="px-3 py-2 rounded-lg text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 transition"
              >
                Simpan sandi
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Konfirmasi status akun"
            className="w-full max-w-md rounded-xl bg-slate-800 border border-slate-700 p-5 space-y-4"
          >
            <h2 className="text-lg font-semibold text-white">
              {confirmTarget.nextState ? 'Aktifkan akun?' : 'Nonaktifkan akun?'}
            </h2>
            <p className="text-sm text-slate-400">
              {confirmTarget.user.email} akan menjadi{' '}
              {confirmTarget.nextState ? 'aktif' : 'nonaktif'}
              {confirmTarget.nextState
                ? '. Akun dapat login kembali.'
                : '. Sesi berikutnya langsung ditolak tanpa menghapus data pengguna.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="px-3 py-2 rounded-lg text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void toggleActive()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 transition"
              >
                Ya, lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
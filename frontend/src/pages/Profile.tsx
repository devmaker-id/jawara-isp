import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { menuItems } from '../config/menu';

interface ProfileForm {
  name: string;
  phone: string;
  address: string;
}

const Profile: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<ProfileForm>({
    name: user?.name || '',
    phone: user?.phone || '',
    address: user?.address || '',
  });

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Photo upload state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [passForm, setPassForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [passLoading, setPassLoading] = useState(false);
  const [passStatus, setPassStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleCancel = () => {
    setForm({
      name: user?.name || '',
      phone: user?.phone || '',
      address: user?.address || '',
    });
    setPhotoFile(null);
    setPhotoPreview(null);
    setStatus(null);
  };

  const handleProfileSave = async () => {
    if (!user) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await api.post('/api/auth/profile', { name: form.name, phone: form.phone, address: form.address });
      if (!res.data.ok) {
        setStatus({ type: 'error', text: res.data.error || 'Gagal menyimpan profil' });
        return;
      }
      setStatus({ type: 'success', text: 'Profil berhasil diperbarui' });
    } catch {
      setStatus({ type: 'error', text: 'Gagal menghubungi server' });
    }
    setLoading(false);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validasi tipe file (hanya gambar)
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      setPhotoStatus({ type: 'error', text: 'Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.' });
      return;
    }

    // Validasi ukuran file (maks 2MB)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      setPhotoStatus({ type: 'error', text: 'Ukuran file maksimal 2 MB.' });
      return;
    }

    setPhotoFile(file);
    // Preview
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setPhotoStatus(null);
  };

  const handlePhotoSave = async () => {
    if (!photoFile || !user) return;
    setPhotoLoading(true);
    setPhotoStatus(null);
    try {
      const formData = new FormData();
      formData.append('avatar', photoFile);

      const res = await api.post('/api/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!res.data.ok) {
        setPhotoStatus({ type: 'error', text: res.data.error || 'Gagal upload foto' });
        return;
      }
      setPhotoStatus({ type: 'success', text: 'Foto profil berhasil diperbarui' });
      setPhotoFile(null);
      setPhotoPreview(null);
    } catch {
      setPhotoStatus({ type: 'error', text: 'Gagal menghubungi server' });
    }
    setPhotoLoading(false);
  };

  const handlePasswordSave = async () => {
    if (passForm.newPassword !== passForm.confirmPassword) {
      setPassStatus({ type: 'error', text: 'Password baru dan konfirmasi tidak cocok' });
      return;
    }
    if (passForm.newPassword.length < 6) {
      setPassStatus({ type: 'error', text: 'Password minimal 6 karakter' });
      return;
    }
    if (!user) return;
    setPassLoading(true);
    setPassStatus(null);
    try {
      const res = await api.post('/api/auth/password', {
        currentPassword: passForm.currentPassword,
        newPassword: passForm.newPassword,
      });
      if (!res.data.ok) {
        setPassStatus({ type: 'error', text: res.data.error || 'Gagal mengupdate password' });
        return;
      }
      setPassStatus({ type: 'success', text: 'Password berhasil diperbarui' });
      setPassForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch {
      setPassStatus({ type: 'error', text: 'Gagal menghubungi server' });
    }
    setPassLoading(false);
  };

  // Guard: only authenticated users can access
  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Anda belum login.</p>
      </div>
    );
  }

  const menu = menuItems ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Profil Akun</h1>
          <p className="text-sm text-slate-400 mt-1">Kelola informasi akun dan sandi.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-3 py-1 rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/50">
            {user.role}
          </span>
          <button
            onClick={() => logout()}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-white transition"
            aria-label="Logout"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Profile photo section */}
      <section className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-slate-600 bg-slate-700 flex-shrink-0">
            {photoPreview ? (
              <img src={photoPreview} alt="Profil" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-1">Foto Profil</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handlePhotoChange}
              className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 transition"
            />
            {photoFile && (
              <p className="text-xs text-slate-400 mt-1">
                File: {photoFile.name} ({Math.round(photoFile.size / 1024)} KB)
              </p>
            )}
          </div>
        </div>
        {photoPreview && (
          <button
            type="button"
            onClick={() => {
              setPhotoFile(null);
              setPhotoPreview(null);
            }}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Hapus foto
          </button>
        )}
        {photoStatus && (
          <p className={`text-sm ${photoStatus.type === 'success' ? 'text-cyan-400' : 'text-red-400'}`}>{photoStatus.text}</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handlePhotoSave}
            disabled={!photoFile || photoLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
          >
            {photoLoading ? 'Menyimpan...' : 'Simpan Foto'}
          </button>
        </div>
      </section>

      {/* Profile info section */}
      <section className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-5 space-y-5">
        <h2 className="text-lg font-semibold text-slate-100">Informasi Akun</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email *</label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-4 py-3 rounded-lg bg-slate-700/30 border border-slate-600/50 text-slate-100 cursor-not-allowed"
            />
            <p className="text-xs text-slate-500 mt-1">Email tidak dapat diubah.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Role *</label>
            <input
              type="text"
              value={user.role}
              disabled
              className="w-full px-4 py-3 rounded-lg bg-slate-700/30 border border-slate-600/50 text-slate-100 cursor-not-allowed"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nama Lengkap</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100"
              placeholder="Nama lengkap"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">No. Telepon</label>
            <input
              type="tel"
              value={form.phone || ''}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100"
              placeholder="08xx"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Alamat</label>
          <textarea
            value={form.address || ''}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            rows={4}
            className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100 resize-y"
            placeholder="Alamat lengkap"
          />
        </div>
        {status && (
          <p className={`text-sm ${status.type === 'success' ? 'text-cyan-400' : 'text-red-400'}`}>{status.text}</p>
        )}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50 transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleProfileSave}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
          >
            {loading ? 'Menyimpan...' : 'Simpan Profil'}
          </button>
        </div>
      </section>

      {/* Password section */}
      <section className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-5 space-y-5">
        <h2 className="text-lg font-semibold text-slate-100">Ubah Password</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Password Saat Ini</label>
            <input
              type="password"
              value={passForm.currentPassword}
              onChange={(e) => setPassForm((f) => ({ ...f, currentPassword: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100"
              placeholder="Masukkan password lama"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Password Baru</label>
            <input
              type="password"
              value={passForm.newPassword}
              onChange={(e) => setPassForm((f) => ({ ...f, newPassword: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100"
              placeholder="Minimal 6 karakter"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Konfirmasi Password</label>
            <input
              type="password"
              value={passForm.confirmPassword}
              onChange={(e) => setPassForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition text-slate-100"
              placeholder="Ulangi password baru"
            />
          </div>
        </div>
        {passStatus && (
          <p className={`text-sm ${passStatus.type === 'success' ? 'text-cyan-400' : 'text-red-400'}`}>{passStatus.text}</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handlePasswordSave}
            disabled={passLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition"
          >
            {passLoading ? 'Menyimpan...' : 'Simpan Password'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default Profile;

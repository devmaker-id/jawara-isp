import React from 'react';

const Settings: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Pengaturan</h1>
        <p className="text-slate-400 text-sm mt-1">Konfigurasi sistem dan integrasi jaringan</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
          <h3 className="text-lg font-semibold text-white mb-4">Integrasi Database</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Host Database</span>
              <span className="text-slate-400 font-mono">127.0.0.1:3306</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Nama Database</span>
              <span className="text-slate-400 font-mono">isp_billing</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">User Database</span>
              <span className="text-slate-400 font-mono">isp_billing</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
          <h3 className="text-lg font-semibold text-white mb-4">Integrasi Jaringan</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">FreeRADIUS</span>
              <span className="text-slate-400 font-mono">127.0.0.1:1812</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">MikroTik API</span>
              <span className="text-slate-400 font-mono">192.168.100.254:1998</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Web Panel</span>
              <span className="text-slate-400 font-mono">:793</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Keamanan</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Login Ganda (2FA)</span>
            <button className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition">Aktifkan</button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Audit Log</span>
            <span className="text-slate-400">Aktif</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Enkripsi Kode</span>
            <span className="text-slate-400">Enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

import React from 'react';

const Packages: React.FC = () => {
  const data = [
    { name: '30Mbps Unlimited', price: 'Rp 49.500', limit: '-', speed: '30', valid: '30 hari', status: 'Aktif' },
    { name: '30Mbps 30GB', price: 'Rp 29.700', limit: '30GB', speed: '30', valid: '30 hari', status: 'Aktif' },
    { name: '50Mbps 50GB', price: 'Rp 39.600', limit: '50GB', speed: '50', valid: '30 hari', status: 'Aktif' },
    { name: '100Mbps 100GB', price: 'Rp 59.400', limit: '100GB', speed: '100', valid: '30 hari', status: 'Aktif' },
    { name: '100Mbps Unlimited', price: 'Rp 79.200', limit: '-', speed: '100', valid: '30 hari', status: 'Tidak Aktif' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Paket Internet</h1>
          <p className="text-slate-400 text-sm mt-1">Kelola paket data dan harga langganan</p>
        </div>
        <button className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Paket
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((pkg) => (
          <div key={pkg.name} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{pkg.name}</h3>
                <p className="text-sm text-slate-400 mt-1">{pkg.limit === '-' ? 'Unlimited' : `Limit: ${pkg.limit}`}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${pkg.status === 'Aktif' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}>
                {pkg.status}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-4 text-sm text-slate-300">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {pkg.speed} Mbps
              </span>
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {pkg.valid}
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xl font-bold text-cyan-400">{pkg.price}</span>
              <div className="flex gap-2">
                <button className="text-slate-400 hover:text-cyan-400 transition">Edit</button>
                <button className="text-slate-400 hover:text-red-400 transition">Hapus</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Packages;

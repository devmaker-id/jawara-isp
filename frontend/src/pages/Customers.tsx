import React from 'react';

const Customers: React.FC = () => {
  const columns = [
    { key: 'name', label: 'Nama' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Telepon' },
    { key: 'status', label: 'Status' },
    { key: 'join', label: 'Bergabung' },
  ];

  const data = [
    { name: 'Budi Santoso', email: 'budi@example.com', phone: '0812-3456-7890', status: 'Aktif', join: '2026-01-15' },
    { name: 'Siti Rahayu', email: 'siti@example.com', phone: '0813-4567-8901', status: 'Aktif', join: '2026-02-01' },
    { name: 'Ahmad Prasetyo', email: 'ahmad@example.com', phone: '0814-5678-9012', status: 'Tidak Aktif', join: '2025-12-10' },
    { name: 'Dewi Lestari', email: 'dewi@example.com', phone: '0815-6789-0123', status: 'Aktif', join: '2026-03-20' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pelanggan</h1>
          <p className="text-slate-400 text-sm mt-1">Kelola data pelanggan dan status layanan mereka</p>
        </div>
        <button className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Pelanggan
        </button>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/30">
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 text-left font-medium text-slate-400">{col.label}</th>
                ))}
                <th className="px-4 py-3 text-right font-medium text-slate-400">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {data.map((customer) => (
                <tr key={customer.email} className="hover:bg-slate-700/20 transition">
                  <td className="px-4 py-3 font-medium text-white">{customer.name}</td>
                  <td className="px-4 py-3 text-slate-300">{customer.email}</td>
                  <td className="px-4 py-3 text-slate-300">{customer.phone}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${customer.status === 'Aktif' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}>
                      {customer.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{customer.join}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-slate-400 hover:text-cyan-400 transition mr-3">Edit</button>
                    <button className="text-slate-400 hover:text-red-400 transition">Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-slate-700/30 flex items-center justify-between text-sm text-slate-400">
          <span>Menampilkan 1-4 dari 1284 pelanggan</span>
          <span>
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            1
          </span>
        </div>
      </div>
    </div>
  );
};

export default Customers;

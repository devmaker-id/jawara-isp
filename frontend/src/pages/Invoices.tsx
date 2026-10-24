import React from 'react';

const Invoices: React.FC = () => {
  const data = [
    { number: 'INV-2026-0001', customer: 'Budi Santoso', amount: 29700, status: 'Lunas', due: '2026-01-15', paid: '2026-01-10' },
    { number: 'INV-2026-0002', customer: 'Siti Rahayu', amount: 39600, status: 'Lunas', due: '2026-02-01', paid: '2026-01-28' },
    { number: 'INV-2026-0003', customer: 'Ahmad Prasetyo', amount: 59400, status: 'Terlambat', due: '2026-03-20', paid: null },
    { number: 'INV-2026-0004', customer: 'Dewi Lestari', amount: 29700, status: 'Lunas', due: '2026-04-01', paid: '2026-03-28' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tagihan</h1>
          <p className="text-slate-400 text-sm mt-1">Kelola tagihan bulanan dan pencatatan pembayaran</p>
        </div>
        <button className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Buat Tagihan
        </button>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/30">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Nomor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Pelanggan</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Jumlah</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Tanggal Jatuh Tempo</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Bayar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {data.map((inv) => (
                <tr key={inv.number} className="hover:bg-slate-700/20 transition">
                  <td className="px-4 py-3 font-medium text-cyan-400">{inv.number}</td>
                  <td className="px-4 py-3 text-slate-300">{inv.customer}</td>
                  <td className="px-4 py-3 text-right text-white">Rp {inv.amount.toLocaleString('id-ID')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      inv.status === 'Lunas' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{inv.due}</td>
                  <td className="px-4 py-3 text-slate-400">{inv.paid || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-slate-700/30 flex items-center justify-between text-sm text-slate-400">
          <span>Menampilkan 1-4 dari 1284 tagihan</span>
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

export default Invoices;

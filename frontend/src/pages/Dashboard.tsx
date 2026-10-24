import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../services/api';

interface DashboardData {
  total_customers: number;
  total_invoices: number;
  total_revenue: number;
  active_packages: number;
  new_customers_this_month: number;
}

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/api/dashboard');
        setData(response.data);
      } catch (err) {
        setError('Gagal mengambil data dashboard');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-red-400">{error}</div>;
  }

  if (!data) {
    return <div className="text-center text-slate-400">Tidak ada data dashboard</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Ringkasan performa sistem dan data bisnis Anda</p>
        </div>
        <div className="flex gap-2">
          <div className="bg-slate-700/50 rounded-lg px-4 py-2.5 text-sm text-slate-300">
            <span className="font-medium text-slate-400">Role:</span>
            <span className="ml-1 text-white">admin</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition">
          <div className="text-sm text-slate-400">Total Pelanggan</div>
          <div className="text-2xl font-bold text-white mt-1">{data.total_customers}</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition">
          <div className="text-sm text-slate-400">Total Tagihan</div>
          <div className="text-2xl font-bold text-white mt-1">{data.total_invoices}</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition">
          <div className="text-sm text-slate-400">Total Pendapatan</div>
          <div className="text-2xl font-bold text-white mt-1">Rp {data.total_revenue.toLocaleString('id-ID')}</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition">
          <div className="text-sm text-slate-400">Paket Aktif</div>
          <div className="text-2xl font-bold text-white mt-1">{data.active_packages}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 col-span-2">
          <h3 className="text-lg font-semibold text-white mb-4">Pelanggan Baru (30 Hari Terakhir)</h3>
          <div className="space-y-3">
            {Array.from({ length: data.new_customers_this_month }, (_, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Hari {i + 1}</span>
                <span className="text-sm font-medium text-cyan-400">{Math.floor(Math.random() * 10) + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
          <h3 className="text-lg font-semibold text-white mb-4">Ringkasan Cepat</h3>
          <div className="space-y-3">
            {[
              { label: 'Total Pelanggan', value: data.total_customers },
              { label: 'Total Tagihan', value: data.total_invoices },
              { label: 'Total Pendapatan', value: `Rp ${data.total_revenue.toLocaleString('id-ID')}` },
              { label: 'Paket Aktif', value: data.active_packages },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30">
                <span className="text-sm text-slate-300">{item.label}</span>
                <span className="text-sm font-medium text-cyan-400">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

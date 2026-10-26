import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Settings from './pages/Settings';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';
import MikrotikRingkasan from './pages/mikrotik/Ringkasan';
import MikrotikPerangkat from './pages/mikrotik/Perangkat';
import MikrotikInterfaces from './pages/mikrotik/Interfaces';
import MikrotikHotspot from './pages/mikrotik/Hotspot';
import MikrotikPpp from './pages/mikrotik/Ppp';
import MikrotikRouting from './pages/mikrotik/Routing';
import RadiusRingkasan from './pages/freeradius/Ringkasan';
import RadiusNas from './pages/freeradius/Nas';
import RadiusSesi from './pages/freeradius/Sesi';
import RadiusAuthLog from './pages/freeradius/AuthLog';
import RadiusKonfigurasi from './pages/freeradius/Konfigurasi';
import RadiusGrup from './pages/freeradius/Grup';
import LayananBandwidth from './pages/layanan/Bandwidth';
import LayananGroup from './pages/layanan/GroupProfile';
import LayananHotspot from './pages/layanan/ServiceProfile';
import LayananPpp from './pages/layanan/ServiceProfile';
import LayananVoucher from './pages/layanan/Voucher';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
    </div>;
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />;
};

// Dashboard menampilkan agregat seluruh pelanggan → ditolak backend untuk
// reseller. Arahkan mereka ke halaman yang memang boleh diakses agar tidak
// berakhir di layar error.
const HomeRoute: React.FC = () => {
  const { user } = useAuth();
  if (user?.role === 'resseler') {
    return <Navigate to="/layanan/hotspot" replace />;
  }
  return <Dashboard />;
};

const AppContent: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route
            path="/"
            element={
              <PrivateRoute>
                <HomeRoute />
              </PrivateRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <PrivateRoute>
                <Customers />
              </PrivateRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <PrivateRoute>
                <Invoices />
              </PrivateRoute>
            }
          />
          <Route
            path="/pembayaran"
            element={
              <PrivateRoute>
                <Payments />
              </PrivateRoute>
            }
          />
          <Route
            path="/laporan"
            element={
              <PrivateRoute>
                <Reports />
              </PrivateRoute>
            }
          />
          <Route
            path="/pengguna"
            element={
              <PrivateRoute>
                <Users />
              </PrivateRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <PrivateRoute>
                <Settings />
              </PrivateRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <PrivateRoute>
                <Profile />
              </PrivateRoute>
            }
          />
          <Route
            path="/mikrotik"
            element={
              <PrivateRoute>
                <MikrotikRingkasan />
              </PrivateRoute>
            }
          />
          <Route
            path="/mikrotik/perangkat"
            element={
              <PrivateRoute>
                <MikrotikPerangkat />
              </PrivateRoute>
            }
          />
          <Route
            path="/mikrotik/interface"
            element={
              <PrivateRoute>
                <MikrotikInterfaces />
              </PrivateRoute>
            }
          />
          <Route
            path="/mikrotik/hotspot"
            element={
              <PrivateRoute>
                <MikrotikHotspot />
              </PrivateRoute>
            }
          />
          <Route
            path="/mikrotik/ppp"
            element={
              <PrivateRoute>
                <MikrotikPpp />
              </PrivateRoute>
            }
          />
          <Route
            path="/mikrotik/routing"
            element={
              <PrivateRoute>
                <MikrotikRouting />
              </PrivateRoute>
            }
          />
          <Route
            path="/freeradius"
            element={
              <PrivateRoute>
                <RadiusRingkasan />
              </PrivateRoute>
            }
          />
          <Route
            path="/freeradius/nas"
            element={
              <PrivateRoute>
                <RadiusNas />
              </PrivateRoute>
            }
          />
          <Route
            path="/freeradius/sesi"
            element={
              <PrivateRoute>
                <RadiusSesi />
              </PrivateRoute>
            }
          />
          <Route
            path="/freeradius/log"
            element={
              <PrivateRoute>
                <RadiusAuthLog />
              </PrivateRoute>
            }
          />
          <Route
            path="/freeradius/konfigurasi"
            element={
              <PrivateRoute>
                <RadiusKonfigurasi />
              </PrivateRoute>
            }
          />
          <Route
            path="/freeradius/grup"
            element={
              <PrivateRoute>
                <RadiusGrup />
              </PrivateRoute>
            }
          />
          <Route path="/layanan/bandwidth" element={<PrivateRoute><LayananBandwidth /></PrivateRoute>} />
          <Route path="/layanan/group" element={<PrivateRoute><LayananGroup /></PrivateRoute>} />
          <Route path="/layanan/hotspot" element={<PrivateRoute><LayananHotspot type="hotspot" /></PrivateRoute>} />
          <Route path="/layanan/ppp" element={<PrivateRoute><LayananPpp type="ppp" /></PrivateRoute>} />
          <Route path="/layanan/voucher" element={<PrivateRoute><LayananVoucher /></PrivateRoute>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;

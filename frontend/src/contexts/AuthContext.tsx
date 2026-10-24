import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api, { classifySessionFailure } from '../services/api';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  phone?: string;
  address?: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        // ignore
      }
    }
    // Verifikasi token ke backend. Hanya 401 yang berarti sesi benar-benar
    // tidak sah. 403, 5xx/503, timeout, dan gangguan jaringan TIDAK menghapus
    // sesi — pengguna tetap masuk dan diminta mencoba lagi, agar gangguan
    // server tidak mengeluarkan seluruh staf dari panel.
    api.get('/api/auth/me')
      .catch((error) => {
        if (classifySessionFailure(error) !== 'unauthenticated') return;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        setToken(null);
      })
      .finally(() => { setLoading(false); });
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/api/auth/login', { email, password });
      const { token: tok, user: userData } = response.data;
      localStorage.setItem('token', tok);
      localStorage.setItem('user', JSON.stringify(userData));
      setToken(tok);
      setUser(userData);
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // backend logout endpoint may be unreachable; continue with local cleanup
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setToken(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

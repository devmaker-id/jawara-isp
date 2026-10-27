import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import api from '../services/api';

/**
 * Identitas panel dari Pengaturan → Branding, satu sumber untuk seluruh UI.
 *
 * Sebelumnya nama panel ditulis di Layout, judul dokumen di index.html, dan
 * nama di halaman login — tiga tempat yang bisa berbeda. Sekarang semuanya
 * membaca nilai yang sama dari `GET /api/branding` (tanpa autentikasi, hanya
 * lima nilai brand).
 *
 * Nilai bawaan di bawah HARUS sama dengan SETTING_DEFAULTS di backend, supaya
 * tampilan saat API belum menjawab tidak berubah-ubah.
 */
export interface Branding {
  name: string;
  tagline: string;
  logo_url: string;
  primary_color: string;
  footer_text: string;
}

export const BRANDING_DEFAULTS: Branding = {
  name: 'JAWARA-ISP',
  tagline: 'BibitNet ISP',
  logo_url: '/branding/logo-default.png',
  primary_color: '#06b6d4',
  footer_text: '',
};

interface BrandingContextType extends Branding {
  /** true bila nilai berasal dari server, bukan bawaan. */
  loaded: boolean;
}

const BrandingContext = createContext<BrandingContextType>({ ...BRANDING_DEFAULTS, loaded: false });

const isColor = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value);

export const BrandingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<Branding>(BRANDING_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<Partial<Branding>>('/api/branding')
      .then((response) => {
        if (!alive) return;
        const data = response.data ?? {};
        setBranding({
          name: data.name?.trim() || BRANDING_DEFAULTS.name,
          tagline: data.tagline?.trim() || BRANDING_DEFAULTS.tagline,
          logo_url: data.logo_url?.trim() || BRANDING_DEFAULTS.logo_url,
          primary_color: isColor(data.primary_color ?? '')
            ? String(data.primary_color)
            : BRANDING_DEFAULTS.primary_color,
          footer_text: data.footer_text?.trim() ?? '',
        });
        setLoaded(true);
      })
      .catch(() => {
        // Panel tetap tampil dengan nilai bawaan; tidak ada pesan galat karena
        // identitas bukan hal yang menghambat pekerjaan operator.
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Warna utama dipakai lewat variabel CSS, bukan kelas Tailwind dinamis:
  // kelas yang dibuat saat runtime tidak ikut dikompilasi Tailwind.
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', branding.primary_color);
    document.title = `${branding.name} — Admin Panel`;
  }, [branding.primary_color, branding.name]);

  return (
    <BrandingContext.Provider value={{ ...branding, loaded }}>{children}</BrandingContext.Provider>
  );
};

export const useBranding = (): BrandingContextType => useContext(BrandingContext);
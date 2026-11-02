import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'jawara-theme';

/** Tema tersimpan di localStorage; default malam (tampilan lama). */
export function getStoredTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'light' ? 'light' : 'dark';
}

/** Terapkan tema ke <html data-theme="..."> supaya CSS variable berganti. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return {
    theme,
    isDark: theme === 'dark',
    toggle: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, getStoredTheme } from './hooks/useTheme';

// Terapkan tema sebelum render supaya tidak ada kedipan terang/gelap.
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

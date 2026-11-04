import React from 'react';

/**
 * Pita peringatan (alert) reusable dengan tiga tone utama:
 *   - success : operasi berhasil (mis. "tersimpan").
 *   - error   : operasi gagal (mis. "gagal").
 *   - warning : perhatian, belum tentu gagal.
 *   - info    : catatan netral tambahan.
 *
 * Responsif: lebar penuh, teks membungkus, ikon tidak menyusut. Bisa ditutup
 * lewat `onDismiss`. Gunakan di seluruh panel sebagai ganti keterangan inline
 * ber-warna sendiri-sendiri, supaya tampilan konsisten.
 */
export type AlertTone = 'success' | 'error' | 'warning' | 'info';

const ICON: Record<AlertTone, string> = {
  success:
    'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  error:
    'M12 9v2m0 4h.01M21 12a9 9 0 11-8.53-8.963A9 9 0 0121 12z',
  warning:
    'M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  info:
    'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

const STYLE: Record<AlertTone, { wrap: string; icon: string }> = {
  success: {
    wrap: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    icon: 'text-emerald-400',
  },
  error: {
    wrap: 'border-red-500/40 bg-red-500/10 text-red-200',
    icon: 'text-red-400',
  },
  warning: {
    wrap: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    icon: 'text-amber-400',
  },
  info: {
    wrap: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    icon: 'text-cyan-400',
  },
};

export interface AlertProps {
  tone?: AlertTone;
  /** Judul opsional ditulis tebal di atas isi. */
  title?: string;
  children?: React.ReactNode;
  /** Bila diset, tombol ✕ ditampilkan. */
  onDismiss?: () => void;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({ tone = 'info', title, children, onDismiss, className }) => {
  const style = STYLE[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${style.wrap} ${className ?? ''}`}
    >
      <svg
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${style.icon}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={ICON[tone]} />
      </svg>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="break-words text-slate-200/90">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Tutup"
          className="flex-shrink-0 rounded-md p-0.5 text-slate-400 transition hover:bg-slate-700/40 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default Alert;
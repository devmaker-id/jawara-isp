import React, { useMemo, useState } from 'react';

/**
 * Kendali "tampilkan N baris" + navigasi halaman.
 *
 * Dipakai untuk dua bentuk data:
 *
 *   1. data sudah ada di browser (mis. log perangkat yang diambil sekali) →
 *      potong dengan `useTablePager`.
 *   2. data diambil per halaman dari server (mis. inventori ONU) → kirim `size`
 *      dan `page` ke API, lalu tampilkan `total` dari server.
 *
 * Alasan: satu tabel berisi 1000+ baris membuat browser berat (DOM besar,
 * scroll tersendat), sedangkan operator jarang butuh melihat semuanya sekaligus.
 */

export const PAGE_SIZES = [25, 50, 100, 500, 1000] as const;

export interface TablePagerProps {
  page: number;
  size: number;
  total: number;
  unit: string;
  loading?: boolean;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}

export const TablePager: React.FC<TablePagerProps> = ({
  page,
  size,
  total,
  unit,
  loading = false,
  onPage,
  onSize,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  // Ukuran yang sedang aktif selalu muncul di daftar, walau bukan kelipatan
  // bawaan (mis. halaman lain memakai 10 atau 20).
  const options = PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number])
    ? [...PAGE_SIZES]
    : [...PAGE_SIZES, size].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-2 border-t border-slate-700/50 bg-slate-700/20 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Menampilkan {first}–{last} dari {total} {unit}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Tampilkan</span>
          <select
            value={size}
            onChange={(event) => onSize(Number(event.target.value))}
            disabled={loading}
            className="rounded-lg border border-slate-600 bg-slate-900/60 px-2 py-1 text-xs text-slate-100"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={loading || page <= 1}
          className="rounded-lg bg-slate-800/60 px-3 py-1.5 transition hover:bg-slate-700 disabled:opacity-40"
        >
          Sebelumnya
        </button>
        <span>
          Halaman {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={loading || page >= totalPages}
          className="rounded-lg bg-slate-800/60 px-3 py-1.5 transition hover:bg-slate-700 disabled:opacity-40"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
};

/**
 * Potong daftar yang sudah dimuat di browser menjadi satu halaman.
 *
 * `reset` bisa dipakai pemanggil untuk kembali ke halaman 1 saat filter berubah
 * (mis. pencarian) — tanpa itu, operator bisa berada di halaman 7 dari hasil
 * yang tinggal 2 baris.
 */
export function useTablePager<T>(rows: T[], initialSize = 25) {
  const [page, setPage] = useState(1);
  const [size, setSizeState] = useState(initialSize);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * size;
    return rows.slice(start, start + size);
  }, [rows, safePage, size]);

  const setSize = (next: number) => {
    setSizeState(next);
    setPage(1);
  };

  return {
    page: safePage,
    size,
    total,
    pageRows,
    setPage,
    setSize,
    /** Kembali ke halaman pertama; panggil saat filter/pencarian berubah. */
    reset: () => setPage(1),
    pagerProps: {
      page: safePage,
      size,
      total,
      onPage: setPage,
      onSize: setSize,
    },
  };
}
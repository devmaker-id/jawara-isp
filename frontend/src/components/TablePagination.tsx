import React from 'react';

// Kontrol pagination ringkas & konsisten untuk halaman daftar (Fase 0).
// Data tetap berasal dari server; komponen ini tidak pernah menyimpan data.
interface TablePaginationProps {
  page: number;
  total: number;
  limit: number;
  loading?: boolean;
  unit: string;
  onPage: (page: number) => void;
}

const TablePagination: React.FC<TablePaginationProps> = ({
  page,
  total,
  limit,
  loading = false,
  unit,
  onPage,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t border-slate-700/50 bg-slate-700/20 text-xs text-slate-400">
      <span>
        Menampilkan {first}–{last} dari {total} {unit}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={loading || page <= 1}
          className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
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
          className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-40 transition"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
};

export default TablePagination;
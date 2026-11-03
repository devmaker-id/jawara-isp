import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPrintDocument,
  mmToPx,
  paginateCards,
  printHtmlDocument,
  printMetrics,
  type VoucherPrintBrand,
  type VoucherPrintCard,
  type VoucherPrintLayout,
} from '../../utils/voucher-print';

/**
 * Print Preview voucher.
 *
 * Satu-satunya renderer tetap `buildPrintDocument` — halaman preview memakai
 * dokumen yang sama persis dengan yang dikirim ke dialog cetak, hanya dipotong
 * per halaman. Jadi yang terlihat di layar = yang tercetak.
 *
 * `window.print()` hanya dipanggil dari tombol "Cetak / Simpan PDF" di sini,
 * bukan saat pengguna menekan "Cetak" pada dialog konfigurasi.
 */

export interface VoucherPrintPreviewProps {
  templateName: string;
  templateHtml: string;
  cards: VoucherPrintCard[];
  layout: VoucherPrintLayout;
  brand: VoucherPrintBrand;
  printedAt: string;
  onBack: () => void;
  onClose: () => void;
}

const PAPER_LABEL: Record<string, string> = {
  a4: 'A4',
  a5: 'A5',
  thermal58: 'Thermal 58 mm',
  thermal80: 'Thermal 80 mm',
  custom: 'Custom',
};

export const VoucherPrintPreview: React.FC<VoucherPrintPreviewProps> = ({
  templateName,
  templateHtml,
  cards,
  layout,
  brand,
  printedAt,
  onBack,
  onClose,
}) => {
  const pages = useMemo(() => paginateCards(cards, layout), [cards, layout]);
  const metrics = useMemo(() => printMetrics(cards.length, layout), [cards.length, layout]);
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const totalPages = Math.max(1, pages.length);
  const safePage = Math.min(page, totalPages - 1);

  // Dokumen halaman aktif — renderer yang sama dengan hasil cetak.
  const pageDoc = useMemo(() => {
    const slice = pages[safePage] ?? [];
    return buildPrintDocument(templateHtml, slice, layout, brand, printedAt);
  }, [pages, safePage, templateHtml, layout, brand, printedAt]);

  // Skala mengikuti lebar panel supaya kertas A4/A5/thermal muat di layar.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const available = stage.clientWidth - 32;
      const paperPx = mmToPx(metrics.paper.widthMm);
      setScale(Math.min(1, Math.max(0.2, available / paperPx)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [metrics.paper.widthMm]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setPage((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowRight') setPage((value) => Math.min(totalPages - 1, value + 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, totalPages]);

  const paperPx = mmToPx(metrics.paper.widthMm);
  const isRoll = metrics.paper.heightMm === null;
  // Gulungan: tinggi dokumen bisa sangat panjang; preview dibatasi dan isinya
  // digulir di dalam iframe supaya halaman tetap ringan.
  const heightPx = isRoll
    ? Math.min(1600, Math.max(900, mmToPx(40) * Math.ceil((pages[safePage]?.length ?? 1) / metrics.columns)))
    : mmToPx(metrics.paper.heightMm as number);

  const firstCard = cards[0];
  const lastCard = cards[cards.length - 1];
  const rangeFrom = safePage * (metrics.rows > 0 ? metrics.perPage : cards.length) + 1;
  const rangeTo =
    metrics.rows > 0
      ? Math.min(cards.length, rangeFrom + (pages[safePage]?.length ?? 0) - 1)
      : cards.length;

  const doPrint = () => {
    printHtmlDocument(buildPrintDocument(templateHtml, cards, layout, brand, printedAt));
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Print preview voucher"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700/60 bg-slate-900/80 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-white">Print Preview</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Periksa susunan sebelum mencetak. Dialog cetak browser baru terbuka setelah Anda menekan
            Cetak / Simpan PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
          >
            ← Kembali ke Pengaturan
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup preview"
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
          >
            Tutup Preview
          </button>
          <button
            type="button"
            onClick={doPrint}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            Cetak / Simpan PDF
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[300px_1fr]">
        {/* Ringkasan konfigurasi sebenarnya (dihitung dari layout, bukan tetap) */}
        <aside className="min-h-0 space-y-2 overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Ringkasan cetak</p>
          <dl className="space-y-1.5">
            {[
              ['Total voucher', String(cards.length)],
              ['Total halaman', String(totalPages)],
              ['Grid', `${metrics.columns} kolom × ${metrics.rows > 0 ? metrics.rows : '—'} baris`],
              ['Voucher per halaman', metrics.rows > 0 ? String(metrics.perPage) : `${cards.length} (mengalir)`],
              ['Ukuran kertas', `${PAPER_LABEL[metrics.paper.kind] ?? metrics.paper.kind} (${metrics.paper.widthMm}×${metrics.paper.heightMm ?? '∞'} mm)`],
              ['Orientasi', metrics.paper.heightMm === null ? 'Gulungan' : metrics.orientation === 'landscape' ? 'Landscape' : 'Portrait'],
              ['Margin / jarak', `${layout.marginMm} mm · ${metrics.gapXMm}×${metrics.gapYMm} mm`],
              ['Garis potong', layout.cutLines ? 'Aktif' : 'Mati'],
              ['Template', templateName || '(bawaan)'],
              ['Halaman ini', `${rangeFrom}–${rangeTo} dari ${cards.length}`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <dt className="text-slate-400">{label}</dt>
                <dd className="text-right font-medium text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
          {firstCard && lastCard && (
            <p className="border-t border-slate-700/60 pt-2 text-xs text-slate-400">
              Rentang kode: <span className="font-mono text-slate-200">{firstCard.username}</span> …{' '}
              <span className="font-mono text-slate-200">{lastCard.username}</span>
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            Preview hanya membaca data. Tidak ada voucher dibuat, diubah, atau digandakan.
          </p>
        </aside>

        {/* Kertas: iframe sandbox tanpa script, dokumen identik dengan hasil cetak */}
        <div ref={stageRef} className="min-h-0 overflow-auto rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
          <div style={{ width: paperPx * scale, height: heightPx * scale, margin: '0 auto' }}>
            <iframe
              title={`Halaman ${safePage + 1}`}
              srcDoc={pageDoc}
              sandbox="allow-modals"
              style={{
                width: paperPx,
                height: heightPx,
                border: 0,
                background: '#fff',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 bg-slate-900/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
          >
            ← Sebelumnya
          </button>
          <span className="text-sm text-slate-300">
            Halaman {safePage + 1} dari {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            disabled={safePage >= totalPages - 1}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
          >
            Berikutnya →
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {cards.length} voucher · {totalPages} halaman · {metrics.orientation === 'landscape' ? 'landscape' : 'portrait'}
        </p>
      </footer>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPrintDocument,
  mmToPx,
  printHtmlDocument,
  printMetrics,
  type VoucherPrintBrand,
  type VoucherPrintCard,
  type VoucherPrintLayout,
} from '../../utils/voucher-print';

/**
 * Print Preview voucher (fluid).
 *
 * Satu-satunya renderer tetap `buildPrintDocument` — preview menampilkan dokumen
 * yang sama persis dengan yang dikirim ke dialog cetak. Kartu mengalir (wrap),
 * jadi semua voucher tampil dalam satu lembar panjang; browser yang memecah
 * halaman saat cetak.
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
  const metrics = useMemo(() => printMetrics(cards.length, layout), [cards.length, layout]);
  // Skala tampilan di layar (fit lebar panel) — terpisah dari skala kartu yang
  // tersimpan di layout dan ikut tercetak.
  const [fit, setFit] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const doc = useMemo(
    () => buildPrintDocument(templateHtml, cards, layout, brand, printedAt),
    [templateHtml, cards, layout, brand, printedAt],
  );

  // Skala mengikuti lebar panel supaya kertas A4/A5/thermal muat di layar.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const compute = () => {
      const available = stage.clientWidth - 32;
      const paperPx = mmToPx(metrics.paper.widthMm);
      setFit(Math.min(1, Math.max(0.2, available / paperPx)));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [metrics.paper.widthMm]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Gulungan thermal: tinggi dokumen ikut banyaknya kartu (mengalir). Kertas
  // lembar: tampilkan satu "halaman" per layar, isinya bisa digulir di iframe.
  const isRoll = metrics.paper.heightMm === null;
  const heightPx = isRoll
    ? Math.min(1600, Math.max(900, mmToPx(40) * Math.ceil(cards.length / Math.max(1, metrics.columns))))
    : mmToPx(metrics.paper.heightMm as number);

  const firstCard = cards[0];
  const lastCard = cards[cards.length - 1];

  const doPrint = () => {
    printHtmlDocument(doc);
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
            Semua voucher tampil mengalir. Dialog cetak browser baru terbuka setelah Anda menekan
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
        <aside className="min-h-0 space-y-2 overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Ringkasan cetak</p>
          <dl className="space-y-1.5">
            {[
              ['Total voucher', String(cards.length)],
              ['Kartu per baris', `${metrics.columns}`],
              ['Lebar kartu', `${metrics.cardWidthMm} mm${metrics.scale !== 1 ? ` × ${metrics.scale}` : ''}`],
              ['Ukuran kertas', `${PAPER_LABEL[metrics.paper.kind] ?? metrics.paper.kind} (${metrics.paper.widthMm}×${metrics.paper.heightMm ?? '∞'} mm)`],
              ['Orientasi', metrics.paper.heightMm === null ? 'Gulungan' : metrics.orientation === 'landscape' ? 'Landscape' : 'Portrait'],
              ['Margin / jarak', `${layout.marginMm} mm · ${metrics.gapMm} mm`],
              ['Garis potong', layout.cutLines ? 'Aktif' : 'Mati'],
              ['Template', templateName || '(bawaan)'],
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

        <div ref={stageRef} className="min-h-0 overflow-auto rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
          <div style={{ width: mmToPx(metrics.paper.widthMm) * fit, height: heightPx * fit, margin: '0 auto' }}>
            <iframe
              title="Pratinjau voucher"
              srcDoc={doc}
              sandbox="allow-modals"
              style={{
                width: mmToPx(metrics.paper.widthMm),
                height: heightPx,
                border: 0,
                background: '#fff',
                transform: `scale(${fit})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 bg-slate-900/80 px-4 py-3">
        <p className="text-xs text-slate-400">
          Kartu mengalir otomatis — browser memecah halaman saat cetak.
        </p>
        <p className="text-xs text-slate-500">
          {cards.length} voucher · {metrics.columns} per baris ·{' '}
          {metrics.orientation === 'landscape' ? 'landscape' : 'portrait'}
        </p>
      </footer>
    </div>
  );
};
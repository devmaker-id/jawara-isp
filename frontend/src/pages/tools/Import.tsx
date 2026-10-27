import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { Badge, Button, Card, ErrorNote, PageHeader, errorMessage } from '../../components/net/NetUI';

// Impor isi database dari file .csv atau .sql.
//
// Dua perilaku yang disengaja:
//  - CSV: kolom dicocokkan dari baris judul. Kolom yang tidak ada di tabel
//    DITOLAK seluruhnya, bukan dilewati diam-diam.
//  - SQL: isi file dijalankan apa adanya, tetapi pernyataan tingkat server
//    (hapus database, ubah hak akses) ditolak backend.
// Backend selalu membuat cadangan .sql sebelum menulis apa pun.

interface TableInfo {
  table: string;
  rows: number;
  columns: string[];
}

interface ImportResult {
  table: string;
  format: 'csv' | 'sql';
  inserted: number;
  skipped: number;
  backup: string | null;
  messages: string[];
}

const ImportPage: React.FC = () => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [format, setFormat] = useState<'csv' | 'sql'>('csv');
  const [table, setTable] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get<TableInfo[]>('/api/tools/tables');
      setTables(data);
      setTable((current) => current || data[0]?.table || '');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickFile = (file: File | null) => {
    setResult(null);
    if (!file) {
      setFilename('');
      setContent('');
      return;
    }
    setFilename(file.name);
    // Format ditebak dari ekstensi, bukan dari isi: lebih mudah diperiksa
    // operator sebelum menekan Impor.
    setFormat(file.name.toLowerCase().endsWith('.sql') ? 'sql' : 'csv');
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.onerror = () => setError('File tidak bisa dibaca dari browser.');
    reader.readAsText(file);
  };

  const selected = tables.find((t) => t.table === table);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post<ImportResult>('/api/tools/import', {
        table: format === 'csv' ? table : undefined,
        format,
        mode,
        content,
      });
      setResult(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cannotSubmit =
    busy || content.trim() === '' || (format === 'csv' && (table === '' || mode === 'replace'));

  return (
    <div className="page-container">
      <PageHeader
        title="Tools — Import Database"
        subtitle="Masukkan data dari file .csv atau .sql. Cadangan .sql dibuat otomatis sebelum penulisan."
      />

      {error && <div className="mb-3"><ErrorNote message={error} onRetry={() => setError(null)} /></div>}

      <Card>
        <div className="mb-4 space-y-2 text-xs text-slate-400">
          <p>
            <span className="text-slate-200">CSV</span> — baris pertama harus nama kolom, persis
            seperti kolom tabel tujuan. Baris yang jumlah kolomnya tidak cocok dilewati dan
            dilaporkan, bukan menggagalkan seluruh file.
          </p>
          <p>
            <span className="text-slate-200">SQL</span> — isi file dump dijalankan berurutan. Cocok
            untuk memulihkan hasil ekspor halaman sebelah. Pernyataan yang bisa menghapus database
            atau mengubah hak akses ditolak.
          </p>
          <p className="text-amber-400">
            Impor CSV mode <span className="font-mono">replace</span> mengosongkan tabel lebih dulu.
            Mode itu sengaja dinonaktifkan di panel: hapus data massal lebih aman lewat .sql yang
            sudah Anda periksa.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Berkas</label>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.sql,text/csv,application/sql"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200"
            />
            {filename && (
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {filename} · {content.length.toLocaleString('id-ID')} karakter
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'sql')}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="csv">CSV (per tabel)</option>
              <option value="sql">SQL (dump)</option>
            </select>
          </div>

          {format === 'csv' && (
            <>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Tabel tujuan</label>
                <select value={table} onChange={(e) => setTable(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                  {tables.map((t) => (
                    <option key={t.table} value={t.table}>
                      {t.table} ({t.rows} baris)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'append' | 'replace')}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                  <option value="append">Tambah (append)</option>
                  <option value="replace" disabled>Kosongkan lalu isi (replace) — tidak tersedia di panel</option>
                </select>
              </div>
            </>
          )}
        </div>

        {format === 'csv' && selected && (
          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-2 font-mono text-[11px] text-slate-400">
            Kolom {selected.table}: {selected.columns.join(', ')}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" onClick={() => void submit()} disabled={cannotSubmit}>
            {busy ? 'Mengimpor…' : 'Impor'}
          </Button>
          {content && (
            <Button onClick={() => { pickFile(null); if (inputRef.current) inputRef.current.value = ''; }}>
              Bersihkan
            </Button>
          )}
        </div>
      </Card>

      {result && (
        <div className="mt-3">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-emerald-400">Impor selesai</p>
              <Badge tone="good">{result.format}</Badge>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-slate-300">
              <div>tabel masuk : {result.table}</div>
              <div>baris        : {result.inserted}</div>
              <div>dilewati     : {result.skipped}</div>
              <div>cadangan     : {result.backup ?? 'tidak ada'}</div>
            </div>
            {result.messages.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-amber-300">
                {result.messages.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">
              Cadangan bisa dipulihkan lewat Import dengan format SQL bila hasilnya tidak sesuai.
            </p>
          </Card>
        </div>
      )}

      <div className="mt-3">
        <Card>
          <p className="text-xs font-semibold text-slate-300">Kenapa cadangan selalu dibuat lebih dulu</p>
          <p className="mt-1 text-xs text-slate-400">
            Impor menulis langsung ke tabel yang dipakai layanan berjalan. Kalau file salah tabel
            atau salah kolom, tidak ada tombol urungkan — yang ada hanyalah salinan .sql sebelum
            penulisan. Berkas cadangan disimpan di{' '}
            <span className="font-mono">~/backups/import-&lt;tabel&gt;-&lt;waktu&gt;.sql</span>.
          </p>
        </Card>
      </div>
    </div>
  );
};

export default ImportPage;

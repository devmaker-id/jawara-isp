import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { Badge, Button, Card, ErrorNote, Loading, PageHeader, Table, errorMessage } from '../../components/net/NetUI';

// Ekspor isi database per tabel. Dua format:
//   .csv — data saja, cocok untuk dibuka di spreadsheet atau diedit massal
//   .sql — skema + data (dump), cocok untuk cadangan dan pemulihan
// Tidak ada yang diubah di sini: seluruh endpoint ekspor hanya membaca.

interface TableInfo {
  table: string;
  rows: number;
  columns: string[];
}

const ExportPage: React.FC = () => {
  const [rows, setRows] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ filename: string; content: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<TableInfo[]>('/api/tools/tables');
      setRows(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (table: string, format: 'csv' | 'sql') => {
    setBusy(`${table}-${format}`);
    setError(null);
    try {
      const { data } = await api.get<string>(`/api/tools/export/${table}`, {
        params: { format },
        responseType: 'text',
        transformResponse: [(value) => value],
      });
      const blob = new Blob([data], { type: format === 'sql' ? 'application/sql' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${table}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const showPreview = async (table: string, format: 'csv' | 'sql') => {
    setBusy(`${table}-${format}-preview`);
    setError(null);
    try {
      const { data } = await api.get<{ filename: string; content: string }>(
        `/api/tools/export/${table}`,
        { params: { format, download: 0 } },
      );
      setPreview({ filename: data.filename, content: data.content });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title="Tools — Export Database"
        subtitle="Unduh isi tabel sebagai .csv atau .sql. Halaman ini hanya membaca; tidak ada data yang diubah."
      />

      {error && <div className="mb-3"><ErrorNote message={error} onRetry={() => void load()} /></div>}

      <Card>
        <div className="mb-3 space-y-2 text-xs text-slate-400">
          <p>
            <span className="text-slate-200">.csv</span> — satu baris judul, data saja. Paling mudah
            dibuka di Excel/Sheets dan disunting massal sebelum diimpor kembali.
          </p>
          <p>
            <span className="text-slate-200">.sql</span> — dump dari mysqldump: skema tabel plus
            datanya. Ini yang dipakai untuk cadangan dan pemulihan, karena bisa dijalankan ulang
            sebagai satu kesatuan.
          </p>
          <p className="text-amber-400">
            Ekspor .csv dibatasi 50.000 baris per tabel agar browser tidak kehabisan memori. Tabel
            sebesar <span className="font-mono">radacct</span> sebaiknya diambil lewat .sql.
          </p>
        </div>

        {loading ? (
          <Loading label="Membaca daftar tabel…" />
        ) : (
          <Table
            columns={['Tabel', 'Baris', 'Kolom', 'Aksi']}
            isEmpty={rows.length === 0}
            empty="Tidak ada tabel yang bisa diekspor."
          >
            {rows.map((row) => (
              <tr key={row.table}>
                <td className="px-3 py-2 font-mono text-xs">{row.table}</td>
                <td className="px-3 py-2 text-xs">
                  {row.rows === 0 ? <Badge tone="mute">kosong</Badge> : row.rows.toLocaleString('id-ID')}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{row.columns.length}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button onClick={() => void download(row.table, 'csv')} disabled={busy !== null}>
                      {busy === `${row.table}-csv` ? 'Menyiapkan…' : 'CSV'}
                    </Button>
                    <Button onClick={() => void download(row.table, 'sql')} disabled={busy !== null}>
                      {busy === `${row.table}-sql` ? 'Menyiapkan…' : 'SQL'}
                    </Button>
                    <Button
                      onClick={() => void showPreview(row.table, 'csv')}
                      disabled={busy !== null || row.rows === 0}
                    >
                      Pratinjau
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {preview && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-slate-100">Pratinjau: <span className="font-mono">{preview.filename}</span></h3>
            <p className="mt-1 text-xs text-slate-400">
              Hanya 4.000 karakter pertama yang ditampilkan; unduhan tetap berisi seluruh data.
            </p>
            <pre className="mt-3 max-h-[55vh] overflow-auto rounded-lg border border-slate-700 bg-black/70 p-3 font-mono text-[11px] text-cyan-200 whitespace-pre-wrap">
              {preview.content.slice(0, 4000)}
            </pre>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setPreview(null)}>Tutup</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportPage;

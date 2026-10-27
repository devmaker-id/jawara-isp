/**
 * Penyaring isi `/log/print` di sisi panel.
 *
 * Dipisah dari service supaya bisa diuji tanpa perangkat. Semua pencocokan
 * memakai huruf kecil: log RouterOS mencampur "Hotspot" dan "hotspot".
 */
export interface RouterLogRow {
  seq: number;
  time: string;
  topics: string;
  message: string;
}

export interface LogFilter {
  topics?: string;
  search?: string;
  limit?: number;
}

export interface LogResult {
  rows: RouterLogRow[];
  matched: number;
  total: number;
  truncated: boolean;
  topics: Array<{ topic: string; count: number }>;
}

export function filterLogs(records: Array<Record<string, string>>, query: LogFilter = {}): LogResult {
  const rows: RouterLogRow[] = records.map((row, index) => ({
    seq: index,
    time: row.time ?? '',
    topics: row.topics ?? '',
    message: row.message ?? '',
  }));

  const wanted = (query.topics ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const search = (query.search ?? '').trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (wanted.length > 0) {
      // Topik RouterOS berupa daftar dipisah koma: "hotspot,info,debug".
      // Cocok bila salah satu topik yang diminta ada di daftar itu.
      const list = row.topics.toLowerCase().split(',').map((item) => item.trim());
      if (!wanted.some((topic) => list.includes(topic))) return false;
    }
    return search === '' || row.message.toLowerCase().includes(search);
  });

  // Hitung dari SELURUH isi log, bukan hasil saring: ini yang memberi tahu
  // topik apa saja yang benar-benar ada di perangkat.
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const topic of row.topics.split(',').map((item) => item.trim()).filter(Boolean)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }

  // `limit` bisa datang sebagai NaN (mis. parameternya dobel di URL); jangan
  // sampai itu menghasilkan 0 baris tanpa pesan.
  const parsed = Math.trunc(Number(query.limit ?? 300));
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 10), 1000) : 300;

  return {
    // /log/print mengirim urutan terlama dulu; tampilkan terbaru di atas.
    rows: filtered.slice().reverse().slice(0, limit),
    matched: filtered.length,
    total: rows.length,
    truncated: filtered.length > limit,
    topics: Array.from(counts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count),
  };
}
// Ekspor CSV dari baris yang SUDAH diterima dari backend (tidak ada angka
// yang dihitung ulang di browser). BOM ditambahkan agar Excel membaca UTF-8.
export function downloadCsv(
  filename: string,
  header: string[],
  rows: Array<Array<string | number | null>>,
): void {
  const escape = (value: string | number | null): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

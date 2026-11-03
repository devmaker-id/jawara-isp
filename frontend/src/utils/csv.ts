// Ekspor CSV dari baris yang SUDAH diterima dari backend (tidak ada angka
// yang dihitung ulang di browser). BOM ditambahkan agar Excel membaca UTF-8.
//
// Nilai teks yang diawali =, +, -, @ (atau tab/CR) diberi awalan apostrof agar
// tidak dieksekusi sebagai formula oleh Excel/Sheets — data pelanggan tidak
// boleh menjadi perintah.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(
  filename: string,
  header: string[],
  rows: Array<Array<string | number | null>>,
): void {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

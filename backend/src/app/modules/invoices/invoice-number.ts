import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

// Nomor tagihan: INV-<tahun>-<urut 4 digit>, mis. INV-2026-0001.
// WAJIB dipanggil di dalam transaksi (conn dari withTransaction) supaya
// SELECT ... FOR UPDATE menahan baris terakhir dan urutnya tidak beradu saat
// dua penulisan benar-benar bersamaan. UNIQUE(invoice_number) tetap jadi
// jaring pengaman terakhir.
export async function nextInvoiceNumber(conn: PoolConnection): Promise<string> {
  const year = new Date().getFullYear();
  const [rows] = await conn.query<RowDataPacket[]>(
    // Hanya cocokkan format berurutan INV-<tahun>-<4 digit>. Format lama
    // (tanggal + hex acak) sengaja dilewati supaya urutan tidak tersangkut.
    `SELECT invoice_number FROM invoices WHERE invoice_number REGEXP ? ORDER BY invoice_number DESC LIMIT 1 FOR UPDATE`,
    [`^INV-${year}-[0-9]{4}$`],
  );
  const last = rows.length > 0 ? String(rows[0].invoice_number) : null;
  const lastSeq = last ? Number(last.split('-')[2]) : 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}
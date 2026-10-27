import { describe, expect, it } from 'vitest';
import { filterLogs } from '../src/app/modules/mikrotik/log-filter';

// Contoh nyata dari /log/print RouterOS 6 (Gajrug): urutan terlama dulu,
// topik berupa daftar dipisah koma.
const RECORDS = [
  { time: '19:15:01', topics: 'hotspot,info,debug', message: '->: AA:BB (192.150.0.81): login failed' },
  { time: '19:20:00', topics: 'system,info,account', message: 'user hermes logged in from 192.168.100.253 via api' },
  { time: '19:21:00', topics: 'hotspot,info', message: 'AA:BB logged in from 192.150.0.81' },
  { time: '19:22:00', topics: 'error,critical', message: 'radius timeout' },
];

describe('filterLogs', () => {
  it('menampilkan yang terbaru lebih dulu', () => {
    const result = filterLogs(RECORDS);
    expect(result.rows[0].message).toBe('radius timeout');
    expect(result.total).toBe(4);
  });

  it('mencocokkan topik di dalam daftar, bukan hanya topik pertama', () => {
    const result = filterLogs(RECORDS, { topics: 'account' });
    expect(result.matched).toBe(1);
    expect(result.rows[0].message).toContain('logged in from 192.168.100.253');
  });

  it('topik yang tidak ada tidak mengembalikan baris', () => {
    expect(filterLogs(RECORDS, { topics: 'bgp' }).matched).toBe(0);
  });

  it('pencarian tidak membedakan huruf besar-kecil', () => {
    const result = filterLogs(RECORDS, { search: 'LOGIN FAILED' });
    expect(result.matched).toBe(1);
  });

  it('menghitung topik dari seluruh log, bukan hasil saring', () => {
    const result = filterLogs(RECORDS, { topics: 'error' });
    const hotspot = result.topics.find((item) => item.topic === 'hotspot');
    expect(result.matched).toBe(1);
    expect(hotspot?.count).toBe(2);
  });

  it('limit tidak wajar tidak mengosongkan hasil', () => {
    // NaN muncul bila parameter URL dobel; dulu hasilnya 0 baris tanpa pesan.
    expect(filterLogs(RECORDS, { limit: Number('x') }).rows.length).toBe(4);
    expect(filterLogs(RECORDS, { limit: 0 }).rows.length).toBe(4);
  });

  it('menandai hasil yang terpotong', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      time: '00:00:01',
      topics: 'info',
      message: `baris ${index}`,
    }));
    const result = filterLogs(many, { limit: 10 });
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});
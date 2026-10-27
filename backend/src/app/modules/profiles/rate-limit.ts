// Pembangkit dan pembaca string rate-limit MikroTik.
//
// Satu fungsi dipakai untuk DUA sisi sekaligus:
//   * ditulis ke MikroTik  (/ip/hotspot/user/profile, /ppp/profile)
//   * ditulis ke RADIUS    (Mikrotik-Rate-Limit di radgroupreply)
// Sehingga kecepatan yang dilihat pelanggan tidak mungkin berbeda antar jalur.
//
// Format MikroTik:
//   rx-rate[/tx-rate] [rx-burst/tx-burst] [rx-threshold/tx-threshold]
//   [rx-burst-time/tx-burst-time] [priority] [rx-min/tx-min]
//
// Konvensi yang dipakai panel (dan ditampilkan di UI sebagai Upload/Download):
//   rx = UPLOAD   (klien → router)
//   tx = DOWNLOAD (router → klien)

/**
 * Burst maksimal = 2x max-limit. Nilai ini juga yang dipakai UI sebagai
 * pratinjau, jadi konstanta-nya diekspor supaya tidak ada dua angka berbeda.
 */
export const BURST_FACTOR = 2;

export interface BandwidthSpec {
  minUploadKbps: number;
  minDownloadKbps: number;
  maxUploadKbps: number;
  maxDownloadKbps: number;
  burstEnabled?: boolean;
  burstUploadKbps?: number | null;
  burstDownloadKbps?: number | null;
  burstThresholdUploadKbps?: number | null;
  burstThresholdDownloadKbps?: number | null;
  burstTimeSec?: number | null;
  priority?: number;
}

export interface ParsedRateLimit {
  maxUploadKbps: number | null;
  maxDownloadKbps: number | null;
  burstUploadKbps: number | null;
  burstDownloadKbps: number | null;
  burstThresholdUploadKbps: number | null;
  burstThresholdDownloadKbps: number | null;
  burstTimeSec: number | null;
  priority: number | null;
  minUploadKbps: number | null;
  minDownloadKbps: number | null;
}

// "10M" → 10000, "512k" → 512, "1000" → 1000.
// MikroTik memakai basis 1000 (bukan 1024) untuk rate-limit.
export function parseRate(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)([kmg]?)$/.exec(text);
  if (!match) return null;
  const base = Number(match[1]);
  const multiplier: Record<string, number> = { '': 1, k: 1, m: 1000, g: 1_000_000 };
  return Math.round(base * (multiplier[match[2]] ?? 1));
}

function kbps(value: number): string {
  return `${Math.round(value)}k`;
}

// String rate-limit siap pakai untuk MikroTik maupun RADIUS.
//
// PENTING — RouterOS membaca bagian ini secara POSISIONAL:
//   max  burst  threshold  burst-time  priority  min-rate
// Kalau salah satu bagian sebelumnya dilewati, token berikutnya bergeser dan
// dibaca sebagai burst. Contoh bug nyata: "5000k/5000k 8 3000k/3000k" membuat
// RouterOS membaca burst=8k (< max 5000k) sehingga login pelanggan gagal:
//   "failed to add queue: download-burst-limit less than download-max-limit".
// Karena itu kepala burst SELALU ditulis. Saat burst dimatikan, burst dan
// threshold diisi sama dengan max — nilai netral, tidak menaikkan kecepatan,
// tetapi membuat posisi priority dan min-rate tetap benar.
export function buildRateLimit(spec: BandwidthSpec): string {
  const maxUp = Math.max(1, Math.round(spec.maxUploadKbps));
  const maxDown = Math.max(1, Math.round(spec.maxDownloadKbps));

  const parts = [`${kbps(maxUp)}/${kbps(maxDown)}`];

  // Model burst: DIHITUNG dari max-limit, bukan diketik manual.
  //   burst     = 2x max (batas atas yang diizinkan)
  //   threshold = max (baru boleh naik kalau pemakaian di bawah max)
  //   time      = 8 detik
  // Nilai burst dari database tetap dihormati HANYA kalau lebih kecil dari 2x
  // dan tidak di bawah max — jadi data lama yang salah tidak bisa lolos, dan
  // kenaikan tidak pernah melebihi 2x.
  const burstOn = spec.burstEnabled === true;
  const ceilingUp = maxUp * BURST_FACTOR;
  const ceilingDown = maxDown * BURST_FACTOR;
  const burstUp = burstOn
    ? Math.min(Math.max(spec.burstUploadKbps ?? ceilingUp, maxUp), ceilingUp)
    : maxUp;
  const burstDown = burstOn
    ? Math.min(Math.max(spec.burstDownloadKbps ?? ceilingDown, maxDown), ceilingDown)
    : maxDown;
  const thrUp = Math.min(burstOn ? (spec.burstThresholdUploadKbps ?? maxUp) : maxUp, burstUp);
  const thrDown = Math.min(burstOn ? (spec.burstThresholdDownloadKbps ?? maxDown) : maxDown, burstDown);
  const time = Math.max(1, Math.round(spec.burstTimeSec ?? 8));

  parts.push(`${kbps(burstUp)}/${kbps(burstDown)}`);
  parts.push(`${kbps(thrUp)}/${kbps(thrDown)}`);
  parts.push(`${time}/${time}`);
  // 8 = prioritas paling rendah; angka terbesar, bukan terkecil.
  parts.push(String(spec.priority ?? 8));

  if (spec.minUploadKbps > 0 || spec.minDownloadKbps > 0) {
    parts.push(`${kbps(spec.minUploadKbps)}/${kbps(spec.minDownloadKbps)}`);
  }

  return parts.join(' ');
}

// Membaca kembali string dari MikroTik agar bisa dibandingkan dengan database.
export function parseRateLimit(value: string | null | undefined): ParsedRateLimit {
  const empty: ParsedRateLimit = {
    maxUploadKbps: null,
    maxDownloadKbps: null,
    burstUploadKbps: null,
    burstDownloadKbps: null,
    burstThresholdUploadKbps: null,
    burstThresholdDownloadKbps: null,
    burstTimeSec: null,
    priority: null,
    minUploadKbps: null,
    minDownloadKbps: null,
  };
  if (!value) return empty;

  // Bagian "a/b" dipecah; bagian tunggal (priority, burst-time) dibiarkan.
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const pair = (token: string | undefined): [number | null, number | null] => {
    if (!token) return [null, null];
    const [left, right] = token.split('/');
    const a = parseRate(left);
    const b = right === undefined ? a : parseRate(right);
    return [a, b];
  };

  const [maxUp, maxDown] = pair(tokens[0]);
  const result: ParsedRateLimit = { ...empty, maxUploadKbps: maxUp, maxDownloadKbps: maxDown };

  // RouterOS menyimpan string lengkap dan berurutan:
  //   0 max · 1 burst · 2 threshold · 3 burst-time · 4 priority · 5 min-rate
  // Posisi dipakai apa adanya (bukan menebak dari bentuk), karena urutan inilah
  // yang juga kita tulis lewat buildRateLimit().
  const [, burst, threshold, time, priority, min] = tokens;

  if (burst) {
    const [up, down] = pair(burst);
    result.burstUploadKbps = up;
    result.burstDownloadKbps = down;
  }
  if (threshold) {
    const [up, down] = pair(threshold);
    result.burstThresholdUploadKbps = up;
    result.burstThresholdDownloadKbps = down;
  }
  if (time) result.burstTimeSec = parseRate(time.split('/')[0]);
  if (priority) {
    const value = parseRate(priority.split('/')[0]);
    result.priority = value === null ? null : value;
  }
  if (min) {
    const [up, down] = pair(min);
    result.minUploadKbps = up;
    result.minDownloadKbps = down;
  }

  return result;
}

// Satuan waktu → detik. Dipakai untuk Session-Timeout dan masa aktif.
export const UNIT_SECONDS: Record<string, number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
  month: 2592000, // 30 hari; masa aktif ISP memakai bulan kalender 30 hari
};

export function unitToSeconds(value: number, unit: string): number {
  return Math.round(value * (UNIT_SECONDS[unit] ?? 1));
}

// Kuota → byte. Basis 1000 agar sama dengan cara ISP menjual kuota.
export const QUOTA_BYTES: Record<string, number> = {
  MB: 1_000_000,
  GB: 1_000_000_000,
};

export function quotaToBytes(value: number, unit: string): number {
  return Math.round(value * (QUOTA_BYTES[unit] ?? 1));
}

// MikroTik-Total-Limit hanya 32-bit; kelebihannya masuk ke Gigawords.
export function splitTotalLimit(bytes: number): { limit: number; gigawords: number } {
  const gigawords = Math.floor(bytes / 4_294_967_296);
  return { limit: bytes % 4_294_967_296, gigawords };
}

// Login-Time RADIUS: "Wk0800-1700" (Sen-Jum), "Al" (semua hari), "Sa|Su".
// Kosong = bebas kapan saja → atribut tidak ditulis sama sekali.
const DAY_CODE: Record<string, string> = {
  mon: 'Mo',
  tue: 'Tu',
  wed: 'We',
  thu: 'Th',
  fri: 'Fr',
  sat: 'Sa',
  sun: 'Su',
};

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

export function dayCode(day: string): string {
  return DAY_CODE[day.toLowerCase()] ?? '';
}

export function buildLoginTime(
  days: string[] | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start || !end) return null;
  const compact = (time: string) => time.replace(/:/g, '').slice(0, 4);
  const window = `${compact(start)}-${compact(end)}`;

  const picked = (days ?? []).map((day) => day.toLowerCase()).filter((day) => DAY_CODE[day]);
  if (picked.length === 0 || ALL_DAYS.every((day) => picked.includes(day))) {
    return `Al${window}`;
  }
  if (WEEKDAYS.every((day) => picked.includes(day)) && picked.length === 5) {
    return `Wk${window}`;
  }

  const codes = [...new Set(picked.map(dayCode))];
  return `${codes.join('|')}${window}`;
}

/** Satu nilai 32-bit; MikroTik memecah kuota besar ke Gigawords. */
const UINT32 = 4_294_967_296;

export interface RadiusAttrRow {
  attribute: string;
  op: string;
  value: string;
}

/**
 * Atribut balasan untuk limitasi sebuah GRUP (profil layanan).
 *
 * - `Session-Timeout` = batas DURASI SATU SESI (detik), bukan akumulasi.
 * - `Mikrotik-Total-Limit` (+`-Gigawords`) = batas TOTAL pemakaian data.
 *
 * Ditulis ke radgroupreply, jadi berlaku untuk semua user dalam grup itu.
 */
export function limitReplyAttributes(input: {
  timeLimitSeconds?: number | null;
  quotaLimitBytes?: number | null;
}): RadiusAttrRow[] {
  const rows: RadiusAttrRow[] = [];

  const seconds = Math.trunc(Number(input.timeLimitSeconds ?? 0));
  if (Number.isFinite(seconds) && seconds > 0) {
    rows.push({ attribute: 'Session-Timeout', op: ':=', value: String(seconds) });
  }

  const bytes = Math.trunc(Number(input.quotaLimitBytes ?? 0));
  if (Number.isFinite(bytes) && bytes > 0) {
    const gigawords = Math.floor(bytes / UINT32);
    rows.push({ attribute: 'Mikrotik-Total-Limit', op: ':=', value: String(bytes % UINT32) });
    if (gigawords > 0) {
      rows.push({ attribute: 'Mikrotik-Total-Limit-Gigawords', op: ':=', value: String(gigawords) });
    }
  }

  return rows;
}

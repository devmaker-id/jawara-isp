// Perbandingan grup RADIUS dengan profil MikroTik.
//
// Kasus nyata: grup FreeRADIUS menyimpan `Mikrotik-Rate-Limit`, sedangkan
// MikroTik punya `/ip/hotspot/user/profile` (dan `/ppp/profile`) dengan
// `rate-limit`. Keduanya harus sama, kalau tidak pelanggan mendapat batas
// berbeda tergantung jalur autentikasi.
//
// Fungsi di sini murni (tanpa I/O) supaya bisa diuji tanpa router.

export interface RadiusGroupSummary {
  groupname: string;
  users: number;
  rate_limit: string | null;
  session_timeout: string | null;
  simultaneous_use: string | null;
}

export interface MikrotikProfileSummary {
  name: string;
  rate_limit: string | null;
  session_timeout?: string | null;
  shared_users?: string | null;
}

export type ParityStatus = 'match' | 'mismatch' | 'radius_only' | 'mikrotik_only';

export interface ParityRow {
  name: string;
  status: ParityStatus;
  radius_rate_limit: string | null;
  mikrotik_rate_limit: string | null;
  radius_session_timeout: string | null;
  mikrotik_session_timeout: string | null;
  radius_simultaneous_use: string | null;
  mikrotik_shared_users: string | null;
  radius_users: number | null;
  /** Keterangan singkat yang bisa langsung ditampilkan di UI. */
  note: string;
}

/**
 * Menormalkan rate-limit agar perbandingan tidak gagal karena spasi/huruf.
 * MikroTik menerima format "rx/tx rx/tx ..." dan hanya entri pertama yang
 * menentukan batas utama, jadi pembanding memakai entri pertama saja.
 */
export function normalizeRateLimit(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.trim().split(/\s+/)[0];
  if (!first || first === '0/0') return null;
  return first.toUpperCase().replace(/\s+/g, '');
}

// Session-Timeout di RADIUS berupa detik; di MikroTik bisa "1h" / "00:30:00".
// Nilai yang tidak bisa diurai dikembalikan apa adanya supaya perbedaan tetap
// terlihat, bukan disembunyikan.
export function normalizeTimeout(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = value.trim();
  if (/^\d+(:\d+){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number).reverse();
    return String((parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600);
  }
  const match = /^(\d+)([smhdw])$/i.exec(text);
  if (match) {
    const unit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
    return String(Number(match[1]) * (unit[match[2].toLowerCase()] ?? 1));
  }
  return text;
}

export function compareGroups(
  groups: RadiusGroupSummary[],
  profiles: MikrotikProfileSummary[],
): ParityRow[] {
  const byRadius = new Map(groups.map((group) => [group.groupname, group]));
  const byMikrotik = new Map(profiles.map((profile) => [profile.name, profile]));

  const names = new Set([...byRadius.keys(), ...byMikrotik.keys()]);
  const rows: ParityRow[] = [];

  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const radius = byRadius.get(name);
    const mikrotik = byMikrotik.get(name);

    const radiusRate = normalizeRateLimit(radius?.rate_limit);
    const mikrotikRate = normalizeRateLimit(mikrotik?.rate_limit);
    const radiusTimeout = normalizeTimeout(radius?.session_timeout);
    const mikrotikTimeout = normalizeTimeout(mikrotik?.session_timeout);

    let status: ParityStatus;
    let note: string;

    if (radius && !mikrotik) {
      status = 'radius_only';
      note = 'Ada di RADIUS, tidak ada di MikroTik. User RADIUS tanpa profil lokal.';
    } else if (!radius && mikrotik) {
      status = 'mikrotik_only';
      note = 'Ada di MikroTik, tidak ada di RADIUS. Hanya berlaku untuk user lokal.';
    } else if (radiusRate !== mikrotikRate) {
      status = 'mismatch';
      note = `Rate-limit berbeda: RADIUS "${radiusRate ?? '-'}" vs MikroTik "${mikrotikRate ?? '-'}".`;
    } else if (radiusTimeout !== mikrotikTimeout) {
      status = 'mismatch';
      note = `Session-Timeout berbeda: RADIUS "${radiusTimeout ?? '-'}" vs MikroTik "${mikrotikTimeout ?? '-'}".`;
    } else {
      status = 'match';
      note = 'Rate-limit dan session-timeout sama.';
    }

    rows.push({
      name,
      status,
      radius_rate_limit: radius?.rate_limit ?? null,
      mikrotik_rate_limit: mikrotik?.rate_limit ?? null,
      radius_session_timeout: radius?.session_timeout ?? null,
      mikrotik_session_timeout: mikrotik?.session_timeout ?? null,
      radius_simultaneous_use: radius?.simultaneous_use ?? null,
      mikrotik_shared_users: mikrotik?.shared_users ?? null,
      radius_users: radius?.users ?? null,
      note,
    });
  }

  return rows;
}

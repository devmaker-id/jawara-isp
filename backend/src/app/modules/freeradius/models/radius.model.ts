// Model skema FreeRADIUS 3.x (migrasi 004_freeradius_schema.sql).
//
// Satu-satunya tempat definisi kontrak database RADIUS di proyek ini.
// Aturan yang dijaga:
//   * Nama kolom & tipe mengikuti migrations/004_freeradius_schema.sql apa adanya.
//   * RADIUS menyimpan kredensial sebagai pasangan attribute/value di
//     radcheck — bukan kolom `password`. Model domain `RadiusUser` adalah
//     hasil join/flatten yang dipakai panel; model baris tetap apa adanya.
//   * `nas.secret` adalah rahasia bersama RADIUS dan TIDAK dimasukkan ke model
//     domain `Nas`. Nilainya hanya dipakai saat membuat/mengubah NAS.
//
// Skema ini BELUM diterapkan di database. Repository wajib memeriksa
// keberadaan tabel sebelum query (lihat RadiusRepository.existingTables()).

export const RADIUS_TABLES = [
  'nas',
  'radcheck',
  'radreply',
  'radgroupcheck',
  'radgroupreply',
  'radusergroup',
  'radacct',
  'radpostauth',
] as const;

export type RadiusTable = (typeof RADIUS_TABLES)[number];

export const RADIUS_MIGRATION = '004_freeradius_schema.sql';

// Atribut radcheck yang diperlakukan panel sebagai "kredensial user".
// Di luar daftar ini, baris radcheck dianggap atribut tambahan (mis. Simultaneous-Use).
export const PASSWORD_ATTRIBUTES = ['Cleartext-Password', 'MD5-Password', 'SHA2-Password'] as const;
export type PasswordAttribute = (typeof PASSWORD_ATTRIBUTES)[number];

/** Atribut yang ditulis panel saat membuat user baru. */
export const DEFAULT_PASSWORD_ATTRIBUTE: PasswordAttribute = 'Cleartext-Password';

/** Operator FreeRADIUS yang sah untuk kolom `op`. */
export const RADIUS_OPS = ['=', ':=', '==', '+=', '!=', '>', '>=', '<', '<='] as const;
export type RadiusOp = (typeof RADIUS_OPS)[number];

// ---------------------------------------------------------------------------
// Baris mentah (bentuk yang dikembalikan mysql2, snake_case)
// ---------------------------------------------------------------------------

/** tabel `nas` — daftar NAS/RADIUS client. */
export interface NasRow {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  server: string | null;
  community: string | null;
  description: string | null;
  secret: string;
  require_ma: number;
  ros_version: RosVersion;
}

/** Versi RouterOS yang perilakunya berbeda terhadap RADIUS. */
export type RosVersion = '6' | '7';

export const ROS_VERSIONS = ['6', '7'] as const;

/**
 * RouterOS 7.15+ mewajibkan Message-Authenticator pada Access-Accept/Reject
 * (`require-message-auth`, default yes-for-request-resp). RouterOS 6 tidak
 * memintanya. `nas.require_ma` adalah turunan dari versi, bukan isian terpisah.
 */
export function requireMessageAuth(version: RosVersion): 0 | 1 {
  return version === '7' ? 1 : 0;
}

/** Kolom yang aman dipilih untuk ditampilkan (tanpa `secret`). */
export const NAS_PUBLIC_COLUMNS = [
  'id',
  'nasname',
  'shortname',
  'type',
  'ports',
  'server',
  'description',
  'ros_version',
] as const;

export const NAS_PUBLIC_SELECT = NAS_PUBLIC_COLUMNS.join(', ');

/** tabel `radcheck` — syarat autentikasi (termasuk password). */
export interface RadcheckRow {
  id: number;
  username: string;
  attribute: string;
  op: string;
  value: string;
}

/** tabel `radreply` — atribut balasan per user (mis. Framed-IP-Address). */
export interface RadreplyRow {
  id: number;
  username: string;
  attribute: string;
  op: string;
  value: string;
}

/** tabel `radgroupcheck` — syarat tingkat grup. */
export interface RadgroupcheckRow {
  id: number;
  groupname: string;
  attribute: string;
  op: string;
  value: string;
}

/** tabel `radgroupreply` — atribut balasan tingkat grup (mis. rate-limit). */
export interface RadgroupreplyRow {
  id: number;
  groupname: string;
  attribute: string;
  op: string;
  value: string;
}

/** tabel `radusergroup` — keanggotaan user pada grup. */
export interface RadusergroupRow {
  id: number;
  username: string;
  groupname: string;
  priority: number;
}

/** tabel `radacct` — akuntansi sesi. `acctstoptime` NULL = sesi masih berjalan. */
export interface RadacctRow {
  radacctid: number;
  acctsessionid: string;
  acctuniqueid: string;
  username: string | null;
  groupname: string | null;
  realm: string | null;
  nasipaddress: string;
  nasportid: string | null;
  nasporttype: string | null;
  acctstarttime: string | null;
  acctupdatetime: string | null;
  acctstoptime: string | null;
  acctinterval: number | null;
  acctsessiontime: number | null;
  acctauthentic: string | null;
  connectinfo_start: string | null;
  connectinfo_stop: string | null;
  acctinputoctets: number | null;
  acctoutputoctets: number | null;
  calledstationid: string;
  callingstationid: string;
  acctterminatecause: string;
  servicetype: string | null;
  framedprotocol: string | null;
  framedipaddress: string;
  framedipv6address: string;
  framedipv6prefix: string;
  framedinterfaceid: string;
  delegatedipv6prefix: string;
  class: string | null;
}

/** tabel `radpostauth` — jejak percobaan autentikasi. */
export interface RadpostauthRow {
  id: number;
  username: string;
  pass: string;
  reply: string;
  calledstationid: string;
  callingstationid: string;
  authdate: string;
  class: string | null;
}

// ---------------------------------------------------------------------------
// Model domain (dipakai service/controller/UI)
// ---------------------------------------------------------------------------

/** NAS tanpa `secret` — satu-satunya bentuk yang boleh keluar ke browser. */
export interface Nas {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  server: string | null;
  description: string | null;
  ros_version: RosVersion;
}

/** User RADIUS hasil flatten radcheck + radusergroup. */
export interface RadiusUser {
  id: number;
  username: string;
  password: string;
  groupname: string | null;
}

/** Sesi aktif (acctstoptime masih NULL). */
export interface RadiusSession {
  radacctid: number;
  username: string;
  nasipaddress: string | null;
  framedipaddress: string | null;
  acctstarttime: string | null;
  acctsessiontime: number | null;
  acctinputoctets: number | null;
  acctoutputoctets: number | null;
  callingstationid: string | null;
}

/** Satu baris log autentikasi (radpostauth + kolom identitas migrasi 011). */
export interface RadiusAuthLog {
  id: number;
  username: string;
  reply: string;
  callingstationid: string | null;
  calledstationid: string | null;
  nasipaddress: string | null;
  nasportid: string | null;
  nasporttype: string | null;
  framedipaddress: string | null;
  authdate: string;
}

/** Sesi selesai, termasuk penyebab berhenti. */
export interface RadiusAccounting extends RadiusSession {
  acctstoptime: string | null;
  acctterminatecause: string | null;
}

/** Keanggotaan grup yang ditampilkan di UI. */
export interface RadiusGroup {
  id: number;
  groupname: string;
  username: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// Mapper baris → domain
// ---------------------------------------------------------------------------

export function toNas(row: NasRow): Nas {
  return {
    id: row.id,
    nasname: row.nasname,
    shortname: row.shortname,
    type: row.type,
    ports: row.ports === null || row.ports === undefined ? null : Number(row.ports),
    server: row.server,
    description: row.description,
    ros_version: row.ros_version === '7' ? '7' : '6',
  };
}

/** radusergroup.priority bertipe INT NOT NULL; dijaga agar tetap number. */
export function toRadiusGroup(row: RadusergroupRow): RadiusGroup {
  return {
    id: row.id,
    groupname: row.groupname,
    username: row.username,
    priority: Number(row.priority),
  };
}

/**
 * Mengubah baris radcheck menjadi pasangan attribute/value yang siap ditulis.
 * Panel hanya menulis password lewat helper ini agar `op` tidak pernah salah.
 */
export function toPasswordRow(username: string, password: string): RadcheckRow {
  return {
    id: 0,
    username,
    attribute: DEFAULT_PASSWORD_ATTRIBUTE,
    op: ':=',
    value: password,
  };
}

/** true bila RADIUS dikenal sebagai password (bukan atribut tambahan). */
export function isPasswordAttribute(attribute: string): boolean {
  return (PASSWORD_ATTRIBUTES as readonly string[]).includes(attribute);
}

/** Total byte masuk+keluar sebuah sesi; null bila data akuntansi belum ada. */
export function totalOctets(session: Pick<RadiusSession, 'acctinputoctets' | 'acctoutputoctets'>): number | null {
  const input = session.acctinputoctets;
  const output = session.acctoutputoctets;
  if (input === null && output === null) return null;
  return Number(input ?? 0) + Number(output ?? 0);
}

import { describe, expect, it } from 'vitest';
import { toRadiusMapping } from '../src/app/modules/profiles/profile-mapping';
import type {
  BandwidthRow,
  GroupProfileRow,
  ServiceProfileRow,
} from '../src/app/modules/profiles/profiles.repository';

// Profil hotspot/PPP adalah penetapan grup + bandwidth + limitasi. Seluruh
// hasilnya harus berupa atribut RADIUS: tidak ada satu pun atribut yang
// mengharuskan panel menulis ke MikroTik.

const bandwidth = {
  id: 1,
  name: '10M',
  min_upload_kbps: 0,
  min_download_kbps: 0,
  max_upload_kbps: 5120,
  max_download_kbps: 10240,
  burst_enabled: 0,
  burst_upload_kbps: null,
  burst_download_kbps: null,
  burst_threshold_upload_kbps: null,
  burst_threshold_download_kbps: null,
  burst_time_sec: null,
  priority: 8,
} as unknown as BandwidthRow;

const group = (over: Partial<GroupProfileRow> = {}) =>
  ({
    id: 10,
    owner_id: 1,
    router_id: 3,
    name: 'HS-RUMAHAN',
    type: 'hotspot',
    pool_mode: 'mikrotik-pool',
    mikrotik_pool_name: 'jw-HS-RUMAHAN',
    pool_local_address: null,
    pool_range_start: null,
    pool_range_end: null,
    pool_created: 1,
    dns_primary: '8.8.8.8',
    dns_secondary: '1.1.1.1',
    parent_queue: 'B.HOTSPOT',
    use_router_default: 0,
    ...over,
  }) as unknown as GroupProfileRow;

const profile = (over: Partial<ServiceProfileRow> = {}) =>
  ({
    id: 7,
    owner_id: 1,
    group_profile_id: 10,
    bandwidth_id: 1,
    name: 'HS-10M-30HARI',
    radius_group: null,
    quota_type: 'limited',
    timebase_value: null,
    timebase_unit: null,
    quotabase_value: 5,
    quotabase_unit: 'GB',
    validity_value: 30,
    validity_unit: 'day',
    shared_users: 1,
    priority: 8,
    login_days: null,
    login_start: null,
    login_end: null,
    ...over,
  }) as unknown as ServiceProfileRow;

const attrsOf = (rows: Array<{ attribute: string; value: string }>) =>
  Object.fromEntries(rows.map((row) => [row.attribute, row.value]));

describe('atribut RADIUS profil hotspot', () => {
  it('membawa limitasi, pool grup, DNS, dan kuota', () => {
    const map = toRadiusMapping(profile(), group(), bandwidth);
    const reply = attrsOf(map.reply);

    expect(reply['Mikrotik-Rate-Limit']).toContain('5120k/10240k');
    // Pool yang dipakai harus disebut RADIUS; kalau tidak, profilnya menunjuk
    // pool yang tidak pernah dipakai router.
    expect(reply['Framed-Pool']).toBe('jw-HS-RUMAHAN');
    expect(reply['Mikrotik-Group']).toBe('HS-RUMAHAN');
    expect(reply['MS-Primary-DNS-Server']).toBe('8.8.8.8');
    expect(reply['MS-Secondary-DNS-Server']).toBe('1.1.1.1');
    // Kuota memakai GB desimal (1 GB = 1e9 byte), lalu dipecah karena
    // Mikrotik-Total-Limit hanya 32-bit: sisanya masuk Gigawords.
    const bytes = 5 * 1_000_000_000;
    expect(reply['Mikrotik-Total-Limit']).toBe(String(bytes % 4_294_967_296));
    expect(reply['Mikrotik-Total-Limit-Gigawords']).toBe(String(Math.floor(bytes / 4_294_967_296)));
    expect(attrsOf(map.check)['Simultaneous-Use']).toBe('1');
  });

  it('batas waktu online menjadi Session-Timeout', () => {
    const map = toRadiusMapping(
      profile({ quota_type: 'limited', timebase_value: 5, timebase_unit: 'hour', quotabase_value: null, quotabase_unit: null }),
      group(),
      bandwidth,
    );
    expect(attrsOf(map.reply)['Session-Timeout']).toBe('18000');
  });

  it('pool RADIUS (sql-ippool) tidak mengirim Framed-Pool nama router', () => {
    const map = toRadiusMapping(
      profile(),
      group({ pool_mode: 'sql-ippool', mikrotik_pool_name: null, pool_range_start: null, pool_range_end: null }),
      bandwidth,
    );
    expect(attrsOf(map.reply)).not.toHaveProperty('Framed-Pool');
  });

  it('grup tanpa parent queue tidak mengirim Mikrotik-Group', () => {
    const map = toRadiusMapping(profile(), group({ parent_queue: null }), bandwidth);
    expect(attrsOf(map.reply)).not.toHaveProperty('Mikrotik-Group');
  });

  it('parent queue DEFAULT diperlakukan sama dengan kosong', () => {
    const map = toRadiusMapping(profile(), group({ parent_queue: 'DEFAULT' }), bandwidth);
    expect(attrsOf(map.reply)).not.toHaveProperty('Mikrotik-Group');
  });
});

describe('GROUP ONLY (Hotspot Only)', () => {
  const groupOnly = group({ pool_mode: 'group-pool', mikrotik_pool_name: null });

  it('tidak mengirim Framed-Pool maupun Mikrotik-Group', () => {
    const map = toRadiusMapping(profile(), groupOnly, bandwidth);
    const reply = attrsOf(map.reply);

    // Tidak ada pool dan tidak ada profil lokal: alamat + queue datang dari
    // profil hotspot bawaan router.
    expect(reply).not.toHaveProperty('Framed-Pool');
    expect(reply).not.toHaveProperty('Mikrotik-Group');
  });

  it('limitasi dan DNS tetap dikirim RADIUS', () => {
    const map = toRadiusMapping(profile(), groupOnly, bandwidth);
    const reply = attrsOf(map.reply);

    expect(reply['Mikrotik-Rate-Limit']).toContain('5120k/10240k');
    expect(reply['MS-Primary-DNS-Server']).toBe('8.8.8.8');
    expect(attrsOf(map.check)['Simultaneous-Use']).toBe('1');
  });
});

describe('limitasi GRUP untuk PPP (radgroupreply)', () => {
  const pppGroup = group({
    type: 'ppp',
    name: 'PPP-10M',
    pool_mode: 'mikrotik-pool',
    mikrotik_pool_name: 'PPP-POOL',
  });

  it('mengirim Session-Timeout dan Total-Limit dari profil', () => {
    const map = toRadiusMapping(
      profile({ quota_type: undefined, timebase_value: null, quotabase_value: null,
                time_limit_seconds: 7200, quota_limit_bytes: 5_000_000_000 }) as never,
      pppGroup,
      bandwidth,
    );
    const reply = attrsOf(map.reply);

    // Berlaku untuk SEMUA user di grup ini — bukan per pelanggan.
    expect(reply['Session-Timeout']).toBe('7200');
    expect(reply['Mikrotik-Total-Limit-Gigawords']).toBe('1');
    expect(reply['Framed-Pool']).toBe('PPP-POOL');
  });

  it('tanpa limit grup, tidak ada atribut batas', () => {
    const map = toRadiusMapping(
      profile({ quota_type: undefined, timebase_value: null, quotabase_value: null,
                time_limit_seconds: null, quota_limit_bytes: null }) as never,
      pppGroup,
      bandwidth,
    );
    const reply = attrsOf(map.reply);
    expect(reply).not.toHaveProperty('Session-Timeout');
    expect(reply).not.toHaveProperty('Mikrotik-Total-Limit');
  });

  it('hotspot tetap memakai timebase/quotabase, bukan kolom PPP', () => {
    const map = toRadiusMapping(
      profile({ quota_type: 'limited', timebase_value: 5, timebase_unit: 'hour',
                quotabase_value: 5, quotabase_unit: 'GB' }) as never,
      group(),
      bandwidth,
    );
    const reply = attrsOf(map.reply);
    expect(reply['Session-Timeout']).toBe('18000');
    expect(reply['Mikrotik-Total-Limit-Gigawords']).toBe('1');
  });
});

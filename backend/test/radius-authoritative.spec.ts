import { describe, expect, it } from 'vitest';
import {
  PARENT_QUEUE_DEFAULT,
  effectiveParentQueue,
  toRadiusMapping,
} from '../src/app/modules/profiles/profile-mapping';
import type {
  BandwidthRow,
  GroupProfileRow,
  ServiceProfileRow,
} from '../src/app/modules/profiles/profiles.repository';

// Model A: RADIUS menyiapkan sendiri atribut AAA. `Mikrotik-Group` adalah NAMA
// PROFIL LOKAL (bukan nama queue) dan hanya dikirim bila grup memakai parent
// queue; nilai DEFAULT berarti "tanpa parent queue" untuk sebagian besar lokasi.
const bandwidth: BandwidthRow = {
  id: 1,
  owner_id: null,
  name: 'BW-10M',
  min_upload_kbps: 10240,
  min_download_kbps: 10240,
  max_upload_kbps: 10240,
  max_download_kbps: 10240,
  burst_enabled: 0,
  burst_upload_kbps: null,
  burst_download_kbps: null,
  burst_threshold_upload_kbps: null,
  burst_threshold_download_kbps: null,
  burst_time_sec: null,
  priority: 8,
} as unknown as BandwidthRow;

const group = (over: Partial<GroupProfileRow> = {}): GroupProfileRow =>
  ({
    id: 1,
    owner_id: null,
    router_id: 1,
    name: 'hs-10m',
    type: 'hotspot',
    pool_mode: 'mikrotik-pool',
    mikrotik_pool_name: 'HS-POOL',
    dns_primary: '8.8.8.8',
    dns_secondary: '1.1.1.1',
    parent_queue: PARENT_QUEUE_DEFAULT,
    use_router_default: 0,
    ...over,
  }) as unknown as GroupProfileRow;

const profile = (over: Partial<ServiceProfileRow> = {}): ServiceProfileRow =>
  ({
    id: 1,
    owner_id: null,
    group_profile_id: 1,
    bandwidth_id: 1,
    name: 'HS-10M-1JAM',
    radius_group: null,
    cost_price: 0,
    sell_price: 5000,
    promo_price: 0,
    tax_percent: 0,
    quota_type: 'limited',
    timebase_value: 1,
    timebase_unit: 'hour',
    quotabase_value: null,
    quotabase_unit: null,
    validity_value: 1,
    validity_unit: 'day',
    shared_users: 1,
    priority: 8,
    login_days: null,
    login_start: null,
    login_end: null,
    is_active: 1,
    ...over,
  }) as unknown as ServiceProfileRow;

const valueOf = (rows: { attribute: string; value: string }[], attribute: string) =>
  rows.find((row) => row.attribute === attribute)?.value;

describe('effectiveParentQueue', () => {
  it('membaca DEFAULT (dan kosong) sebagai tanpa parent queue', () => {
    expect(effectiveParentQueue(PARENT_QUEUE_DEFAULT)).toBeNull();
    expect(effectiveParentQueue('default')).toBeNull();
    expect(effectiveParentQueue('')).toBeNull();
    expect(effectiveParentQueue(null)).toBeNull();
    expect(effectiveParentQueue('   ')).toBeNull();
  });

  it('memakai nama queue apa adanya bila diisi', () => {
    expect(effectiveParentQueue('A.CLIENT-PPP')).toBe('A.CLIENT-PPP');
    expect(effectiveParentQueue(' B.HOTSPOT ')).toBe('B.HOTSPOT');
  });
});

describe('toRadiusMapping (Model A)', () => {
  it('selalu mengirim rate-limit dari bandwidth', () => {
    const { reply } = toRadiusMapping(profile(), group(), bandwidth);
    // Format posisional RouterOS: max burst threshold burst-time priority min.
    // Kepala burst wajib ada; kalau tidak, priority bergeser ke posisi burst
    // dan router menolak queue ("burst-limit less than max-limit").
    expect(valueOf(reply, 'Mikrotik-Rate-Limit')).toBe(
      '10240k/10240k 10240k/10240k 10240k/10240k 8/8 8 10240k/10240k',
    );
  });

  it('TIDAK mengirim Mikrotik-Group saat parent queue DEFAULT', () => {
    const { reply } = toRadiusMapping(profile(), group(), bandwidth);
    expect(valueOf(reply, 'Mikrotik-Group')).toBeUndefined();
  });

  it('mengirim Mikrotik-Group = nama profil lokal saat parent queue diisi', () => {
    const { reply } = toRadiusMapping(
      profile(),
      group({ parent_queue: 'B.HOTSPOT' }),
      bandwidth,
    );
    // Bukan nama queue: yang dikirim adalah nama profil lokal yang membawa
    // setelan parent-queue. Mengirim nama queue membuat router mencari profil
    // bernama "B.HOTSPOT" dan gagal.
    expect(valueOf(reply, 'Mikrotik-Group')).toBe('hs-10m');
  });

  it('mengirim pool, DNS, batas waktu, dan Simultaneous-Use', () => {
    const { reply, check } = toRadiusMapping(profile(), group(), bandwidth);
    expect(valueOf(reply, 'Framed-Pool')).toBe('HS-POOL');
    expect(valueOf(reply, 'MS-Primary-DNS-Server')).toBe('8.8.8.8');
    expect(valueOf(reply, 'Session-Timeout')).toBe('3600');
    expect(valueOf(check, 'Simultaneous-Use')).toBe('1');
  });

  it('mengirim batas kuota sebagai Mikrotik-Total-Limit', () => {
    const { reply } = toRadiusMapping(
      profile({ timebase_value: null, timebase_unit: null, quotabase_value: 1, quotabase_unit: 'GB' }),
      group(),
      bandwidth,
    );
    expect(valueOf(reply, 'Session-Timeout')).toBeUndefined();
    expect(valueOf(reply, 'Mikrotik-Total-Limit')).toBeDefined();
  });
});

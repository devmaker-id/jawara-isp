// Pemetaan Profile → atribut RADIUS dan perintah MikroTik.
//
// Semua fungsi di sini murni (tanpa I/O) agar bisa diuji dan agar RADIUS serta
// MikroTik dijamin memakai angka yang sama.

import {
  buildLoginTime,
  buildRateLimit,
  limitReplyAttributes,
  quotaToBytes,
  splitTotalLimit,
  unitToSeconds,
} from './rate-limit';
import type { BandwidthRow, GroupProfileRow, ServiceProfileRow } from './profiles.repository';

export interface RadiusAttribute {
  attribute: string;
  op: string;
  value: string;
}

export interface RadiusMapping {
  reply: RadiusAttribute[];
  check: RadiusAttribute[];
}

function push(list: RadiusAttribute[], attribute: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return;
  list.push({ attribute, op: ':=', value: String(value) });
}

function bandwidthSpec(bandwidth: BandwidthRow) {
  return {
    minUploadKbps: Number(bandwidth.min_upload_kbps),
    minDownloadKbps: Number(bandwidth.min_download_kbps),
    maxUploadKbps: Number(bandwidth.max_upload_kbps),
    maxDownloadKbps: Number(bandwidth.max_download_kbps),
    burstEnabled: Number(bandwidth.burst_enabled) === 1,
    burstUploadKbps: bandwidth.burst_upload_kbps,
    burstDownloadKbps: bandwidth.burst_download_kbps,
    burstThresholdUploadKbps: bandwidth.burst_threshold_upload_kbps,
    burstThresholdDownloadKbps: bandwidth.burst_threshold_download_kbps,
    burstTimeSec: bandwidth.burst_time_sec,
    priority: Number(bandwidth.priority),
  };
}

/** Hari login disimpan sebagai SET('mon,...'); dipakai sebagai array. */
export function parseLoginDays(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((day) => day.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Sentinel untuk `group_profiles.parent_queue`: tidak memakai parent queue.
 * Sebagian besar lokasi tidak menyetelnya, jadi nilai kosong/NULL dibaca
 * sebagai DEFAULT, bukan sebagai nama queue yang harus dibuat.
 */
export const PARENT_QUEUE_DEFAULT = 'DEFAULT';

/** Nama parent queue yang benar-benar dipakai, atau null bila DEFAULT. */
export function effectiveParentQueue(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === PARENT_QUEUE_DEFAULT) return null;
  return trimmed;
}

/**
 * Atribut yang ditulis ke radgroupreply/radgroupcheck untuk sebuah profil.
 *
 * Model A: RADIUS adalah sumber kebenaran atribut AAA. Rate-limit, pool, DNS,
 * batas waktu, dan batas kuota dikirim sebagai atribut balasan — router tidak
 * perlu menyetelnya sendiri.
 *
 * `Mikrotik-Group` hanya dikirim bila grup memang memakai parent queue DAN
 * profil lokalnya benar-benar ada. Satu-satunya cara queue dinamis masuk ke
 * induk tertentu adalah lewat profil lokal router. Bila parent queue = DEFAULT,
 * atau grup memakai mode GROUP ONLY (tidak membuat profil lokal), atribut ini
 * dihilangkan supaya router memakai profil bawaannya — persis "IS DEFAULT"
 * yang diinginkan.
 */
export function toRadiusMapping(
  profile: ServiceProfileRow,
  group: GroupProfileRow,
  bandwidth: BandwidthRow,
): RadiusMapping {
  const reply: RadiusAttribute[] = [];
  const check: RadiusAttribute[] = [];

  push(reply, 'Mikrotik-Rate-Limit', buildRateLimit(bandwidthSpec(bandwidth)));

  // Mikrotik-Group = NAMA PROFIL LOKAL (bukan nama queue). Profil lokal itulah
  // yang membawa setelan parent-queue; queue dinamis mengikuti induknya.
  //
  // GROUP ONLY tidak membuat profil lokal di router (RADIUS memakai profil
  // bawaan), jadi menunjuk nama profil di sini akan menunjuk objek yang tidak
  // ada. `use_router_default` sama: tidak ada profil milik grup.
  const hasLocalProfile = group.pool_mode !== 'group-pool' && group.use_router_default !== 1;
  if (hasLocalProfile && effectiveParentQueue(group.parent_queue)) {
    push(reply, 'Mikrotik-Group', group.name);
  }

  // Pool dari router berlaku untuk pool yang sudah ada (mikrotik-pool) maupun
  // pool yang dibuat panel (router-pool): keduanya objek nyata di perangkat.
  // GROUP ONLY tidak punya pool — alamat datang dari profil hotspot bawaan.
  if (group.pool_mode === 'mikrotik-pool' || group.pool_mode === 'router-pool') {
    push(reply, 'Framed-Pool', group.mikrotik_pool_name);
  }

  push(reply, 'MS-Primary-DNS-Server', group.dns_primary);
  push(reply, 'MS-Secondary-DNS-Server', group.dns_secondary);

  // Batas lama online. Hotspot memakai timebase (nilai + satuan); PPP memakai
  // detik langsung karena tidak punya kolom timebase.
  if (profile.timebase_value && profile.timebase_unit) {
    push(reply, 'Session-Timeout', unitToSeconds(profile.timebase_value, profile.timebase_unit));
  }
  // Limitasi GRUP untuk PPP. Ditulis ke radgroupreply, jadi berlaku untuk semua
  // user di grup ini — bukan per pelanggan.
  if (group.type === 'ppp') {
    for (const row of limitReplyAttributes({
      timeLimitSeconds: profile.time_limit_seconds,
      quotaLimitBytes: profile.quota_limit_bytes,
    })) {
      // Session-Timeout bisa sudah dikirim dari timebase; jangan dobel.
      if (row.attribute === 'Session-Timeout' && reply.some((r) => r.attribute === 'Session-Timeout')) {
        continue;
      }
      push(reply, row.attribute, row.value);
    }
  }

  // Batas pemakaian data.
  if (profile.quotabase_value && profile.quotabase_unit) {
    const bytes = quotaToBytes(profile.quotabase_value, profile.quotabase_unit);
    const split = splitTotalLimit(bytes);
    push(reply, 'Mikrotik-Total-Limit', split.limit);
    if (split.gigawords > 0) push(reply, 'Mikrotik-Total-Limit-Gigawords', split.gigawords);
  }

  push(check, 'Simultaneous-Use', Number(profile.shared_users));

  const loginTime = buildLoginTime(
    parseLoginDays(profile.login_days),
    profile.login_start,
    profile.login_end,
  );
  push(check, 'Login-Time', loginTime);

  return { reply, check };
}

/** Harga akhir yang dibayar pelanggan: promo bila ada, lalu PPN menaikkan. */
export function finalPrice(profile: {
  sell_price: number;
  promo_price: number;
  tax_percent: number;
}): { base: number; tax: number; total: number } {
  const sell = Number(profile.sell_price);
  const promo = Number(profile.promo_price);
  // Promo hanya dipakai bila lebih murah dari harga jual dan lebih dari 0.
  const base = promo > 0 && promo < sell ? promo : sell;
  const tax = Math.round(base * (Number(profile.tax_percent) / 100) * 100) / 100;
  return { base, tax, total: Math.round((base + tax) * 100) / 100 };
}

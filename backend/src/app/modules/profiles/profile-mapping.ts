// Pemetaan Profile → atribut RADIUS dan perintah MikroTik.
//
// Semua fungsi di sini murni (tanpa I/O) agar bisa diuji dan agar RADIUS serta
// MikroTik dijamin memakai angka yang sama.

import {
  buildLoginTime,
  buildRateLimit,
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
 * `Mikrotik-Group` hanya dikirim bila grup memang memakai parent queue, karena
 * satu-satunya cara queue dinamis masuk ke induk tertentu adalah lewat profil
 * lokal router. Bila parent queue = DEFAULT, atribut ini dihilangkan supaya
 * router memakai profil bawaannya — persis "IS DEFAULT" yang diinginkan.
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
  if (effectiveParentQueue(group.parent_queue)) {
    push(reply, 'Mikrotik-Group', group.name);
  }

  // Pool dari router hanya berlaku bila grup memakai pool MikroTik.
  if (group.pool_mode === 'mikrotik-pool') {
    push(reply, 'Framed-Pool', group.mikrotik_pool_name);
  }

  push(reply, 'MS-Primary-DNS-Server', group.dns_primary);
  push(reply, 'MS-Secondary-DNS-Server', group.dns_secondary);

  // Batas lama online (hotspot limited).
  if (profile.timebase_value && profile.timebase_unit) {
    push(reply, 'Session-Timeout', unitToSeconds(profile.timebase_value, profile.timebase_unit));
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

export interface PreviewCommand {
  /** Perintah yang bisa ditempel di terminal MikroTik. */
  command: string;
  /** Keterangan singkat mengapa perintah ini ada. */
  note: string;
}

/**
 * Perintah MikroTik yang perlu dijalankan agar profil di router sama dengan
 * panel. Dihasilkan sebagai teks: akun API saat ini read-only, jadi panel tidak
 * mengirimnya sendiri.
 */
export function toMikrotikCommands(
  profile: ServiceProfileRow,
  group: GroupProfileRow,
  bandwidth: BandwidthRow,
): PreviewCommand[] {
  const rate = buildRateLimit(bandwidthSpec(bandwidth));
  const commands: PreviewCommand[] = [];
  const dns = [group.dns_primary, group.dns_secondary].filter(Boolean).join(',');

  if (group.use_router_default === 1) {
    commands.push({
      command: '# grup memakai profil bawaan router — tidak ada profil baru dibuat',
      note: 'use_router_default aktif pada Group Profile.',
    });
  } else if (group.type === 'hotspot') {
    const parts = [
      `/ip hotspot user profile add name=${group.name}`,
      `rate-limit="${rate}"`,
      `shared-users=${profile.shared_users}`,
    ];
    if (profile.timebase_value && profile.timebase_unit) {
      parts.push(`session-timeout=${unitToSeconds(profile.timebase_value, profile.timebase_unit)}`);
    }
    if (group.pool_mode === 'mikrotik-pool' && group.mikrotik_pool_name) {
      parts.push(`address-pool=${group.mikrotik_pool_name}`);
    }
    commands.push({
      command: parts.join(' '),
      note: 'Profil user hotspot; nama = nama Group Profile.',
    });
  } else {
    const parts = [`/ppp profile add name=${group.name}`, `rate-limit="${rate}"`];
    if (dns) parts.push(`dns-server=${dns}`);
    if (group.pool_mode === 'mikrotik-pool' && group.mikrotik_pool_name) {
      parts.push(`remote-address=${group.mikrotik_pool_name}`);
    }
    commands.push({
      command: parts.join(' '),
      note: 'Profil PPP; nama = nama Group Profile.',
    });
  }

  const parentQueue = effectiveParentQueue(group.parent_queue);
  if (parentQueue) {
    // Parent queue tidak punya parameter di profil hotspot/PPP: queue dinamis
    // mengikuti induk yang ditunjuk pada queue tree. Perintah ini hanya contoh
    // yang perlu disesuaikan interface/target-nya.
    commands.push({
      command:
        `# parent queue "${parentQueue}" dipakai sebagai induk queue dinamis\n` +
        `# /queue tree add name=${group.name}-parent parent=${parentQueue} …`,
      note: 'Parent queue merujuk nama yang sudah ada di MikroTik (ditulis manual).',
    });
  }

  return commands;
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

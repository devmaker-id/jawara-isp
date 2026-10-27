// Status pelanggan → atribut RADIUS per user (radcheck).
//
// Limitasi TIDAK di sini: keputusan final menaruh batas waktu/kuota pada GRUP
// (profil layanan) dan menulisnya ke radgroupreply. Yang per user hanyalah
// status: boleh login atau ditolak.
//
// Murni (tanpa I/O) agar bisa diuji dan agar UI serta backend memakai angka
// yang sama.
//
// Kenapa per-user (radreply), bukan per grup (radgroupreply): atribut grup
// berlaku untuk SEMUA user di profil itu. Batas waktu dan kuota milik satu
// pelanggan tidak boleh menular ke pelanggan lain.

export type CustomerStatus = 'active' | 'expired' | 'suspend' | 'disable';

export const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'expired', 'suspend', 'disable'];

export interface RadiusRow {
  attribute: string;
  op: string;
  value: string;
}

/**
 * Atribut pemeriksaan tambahan di `radcheck` menurut status pelanggan.
 *
 * - active  → tidak ada tambahan (login normal)
 * - expired → `Expiration` di masa lalu; FreeRADIUS menolak sendiri
 * - suspend → `Auth-Type := Reject` (ditangguhkan sementara)
 * - disable → `Auth-Type := Reject` (dimatikan permanen)
 *
 * `Expiration` menerima tanggal tanpa spasi sesuai format FreeRADIUS.
 */
export function statusCheckAttributes(
  status: CustomerStatus,
  expiresAt?: Date | string | null,
): RadiusRow[] {
  if (status === 'active') return [];

  if (status === 'expired') {
    const when = expiresAt ? new Date(expiresAt) : new Date();
    const valid = Number.isNaN(when.getTime()) ? new Date() : when;
    return [{ attribute: 'Expiration', op: ':=', value: freeRadiusDate(valid) }];
  }

  return [{ attribute: 'Auth-Type', op: ':=', value: 'Reject' }];
}

/** Format tanggal FreeRADIUS: "26 Oct 2026 15:00:00". */
export function freeRadiusDate(date: Date): string {
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${two(date.getDate())} ${bulan[date.getMonth()]} ${date.getFullYear()} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

/**
 * Status akun RADIUS yang sepadan dengan status pelanggan.
 *
 * `expired` adalah satu-satunya status akun yang juga berarti "tidak boleh
 * login" tanpa perlu atribut penolak tambahan di sisi panel.
 */
export function voucherStatusFor(status: CustomerStatus): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'expired':
      return 'expired';
    default:
      // suspend/disable: akun tetap ada dan bisa diaktifkan lagi tanpa
      // membuat username baru.
      return 'ready-to-use';
  }
}

/** Status pelanggan dari akun/voucher sebaliknya, untuk tampilan. */
export function isBlockingStatus(status: CustomerStatus): boolean {
  return status !== 'active';
}

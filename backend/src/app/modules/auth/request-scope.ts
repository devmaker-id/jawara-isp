import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

// Cakupan data (scope) ditentukan HANYA dari akun terautentikasi di server.
// Tidak ada jalur yang menerima reseller_id dari query/body sebagai dasar
// otorisasi: nilai itu hanya boleh dipakai admin sebagai TARGET penugasan.
export type ScopeKind = 'customers' | 'invoices' | 'services' | 'payments';

export interface RequestScope {
  role: string;
  userId: number | null;
  isReseller: boolean;
  // ID reseller yang dipakai untuk memfilter baris. null = tanpa filter.
  ownerId: number | null;
}

// Dipakai untuk pemanggilan internal (bootstrap, job, tes) yang tidak melewati
// guard. Setara admin: tanpa filter.
export const SYSTEM_SCOPE: RequestScope = Object.freeze({
  role: 'admin',
  userId: null,
  isReseller: false,
  ownerId: null,
});

// Nilai enum aktual di database adalah 'resseler'; 'reseller' ditoleransi agar
// tidak pecah bila enum dinormalisasi kelak.
export function isResellerRole(role: unknown): boolean {
  return role === 'resseler' || role === 'reseller';
}

export function scopeFromUser(
  user?: { sub?: number; role?: string } | null,
): RequestScope {
  if (!user) return SYSTEM_SCOPE;
  const isReseller = isResellerRole(user.role);
  const sub = Number(user.sub);
  const userId = Number.isInteger(sub) && sub > 0 ? sub : null;
  return {
    role: String(user.role ?? ''),
    userId,
    isReseller,
    ownerId: isReseller ? userId : null,
  };
}

// Filter SQL wajib, bukan filter di memori. Dipakai pada SELECT daftar, detail,
// COUNT total, dan agregat supaya jumlah/ringkasan tidak membocorkan data
// reseller lain.
//
// Fail-closed: reseller tanpa identitas yang sah menghasilkan `1 = 0`
// (tidak ada baris), bukan seluruh data.
export function ownerFilter(
  scope: RequestScope | undefined,
  kind: ScopeKind,
): { sql: string; params: number[] } {
  if (!scope || !scope.isReseller) return { sql: '', params: [] };

  const ownerId = scope.ownerId;
  if (ownerId === null || !Number.isInteger(ownerId) || ownerId <= 0) {
    return { sql: '1 = 0', params: [] };
  }

  switch (kind) {
    case 'customers':
      return { sql: 'owner_id = ?', params: [ownerId] };
    case 'invoices':
      return {
        sql: 'customer_id IN (SELECT owner_c.id FROM customers owner_c WHERE owner_c.owner_id = ?)',
        params: [ownerId],
      };
    case 'services':
      return {
        sql: 's.customer_id IN (SELECT owner_c.id FROM customers owner_c WHERE owner_c.owner_id = ?)',
        params: [ownerId],
      };
    case 'payments':
      return {
        sql: 'i.customer_id IN (SELECT owner_c.id FROM customers owner_c WHERE owner_c.owner_id = ?)',
        params: [ownerId],
      };
  }
}

// Kolom pemilik (customers.owner_id) belum ada — migrasi 003/020 belum
// dijalankan. Query reseller akan gagal di database; pemanggil menerjemahkannya
// menjadi 503 yang jujur, bukan daftar kosong yang menyesatkan.
export function isMissingOwnerColumn(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return (
    candidate?.code === 'ER_BAD_FIELD_ERROR' &&
    /(owner_id|reseller_id)/i.test(String(candidate?.message ?? ''))
  );
}

// Decorator: ambil scope dari request yang sudah lolos JwtAuthGuard.
export const Scope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestScope =>
    scopeFromUser(context.switchToHttp().getRequest<AuthenticatedRequest>().user),
);
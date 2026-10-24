import { SetMetadata } from '@nestjs/common';
import { RoleValues } from '../../config/config.service';

// Satu sumber kebenaran: daftar role diturunkan dari RoleValues, bukan
// ditulis ulang, agar tidak ada dua daftar yang bisa menyimpang.
export const ROLES = [RoleValues.ADMIN, RoleValues.OPERATOR, RoleValues.RESSELER] as const;
export type AppRole = (typeof ROLES)[number];

export function isKnownRole(role: unknown): role is AppRole {
  return typeof role === 'string' && (ROLES as readonly string[]).includes(role);
}

export const ROLES_KEY = 'rbac:roles';

// Menandai endpoint dengan role yang diizinkan. Tanpa decorator ini,
// endpoint hanya mewajibkan autentikasi (perilaku lama tetap jalan).
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

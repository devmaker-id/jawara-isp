import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { PermissionsService } from './permissions.service';

/**
 * Penegakan izin per endpoint.
 *
 * Dipasang SETELAH JwtAuthGuard: guard ini hanya membaca `req.user` yang sudah
 * diverifikasi tanda tangannya, tidak pernah menerima role dari body/query.
 *
 * Admin tidak dibatasi sama sekali (keputusan pemilik panel). Untuk role lain,
 * izin dibaca dari tabel: penimpaan per akun menang atas nilai role.
 */
export const PERMISSION_KEY = 'required_permission';

/** `@RequirePermission('customer.create')` pada handler atau controller. */
export const RequirePermission = (code: string) => SetMetadata(PERMISSION_KEY, code);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = Number(request.user?.sub ?? 0);
    const role = String(request.user?.role ?? '');
    if (!userId) {
      throw new ForbiddenException('Sesi tidak dikenali. Silakan masuk kembali.');
    }

    if (await this.permissions.can(userId, role, required)) return true;

    // Pesan menyebut izinnya supaya operator tahu apa yang harus diminta,
    // tanpa membocorkan struktur internal.
    throw new ForbiddenException(
      `Akun Anda tidak memiliki izin "${required}". Minta administrator membukanya di menu Pengguna.`,
    );
  }
}

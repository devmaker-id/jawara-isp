import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './auth.guard';
import { AppRole, ROLES_KEY } from './roles.decorator';

// Dijalankan SETELAH JwtAuthGuard: guard ini hanya memeriksa role pada
// req.user yang sudah diverifikasi tanda tangannya.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Tanpa @Roles(...) → cukup terautentikasi (tidak mengubah perilaku lama).
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role as AppRole | undefined;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Anda tidak memiliki izin untuk mengakses sumber daya ini');
    }

    return true;
  }
}

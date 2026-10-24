import {
  Injectable,
  CanActivate,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(req);

    if (!token) {
      throw new UnauthorizedException('Tidak ada token autentikasi');
    }

    try {
      const payload = await this.authService.verifyToken(token) as JwtPayload;
      req.user = payload;
    } catch {
      throw new UnauthorizedException('Token tidak valid atau sudah kedaluwarsa');
    }

    if (this.authService.isTokenRevoked(token)) {
      throw new UnauthorizedException('Sesi telah diakhiri (token dicabut)');
    }

    return true;
  }
}

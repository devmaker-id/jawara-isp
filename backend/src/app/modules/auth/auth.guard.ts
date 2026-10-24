import {
  Injectable,
  CanActivate,
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { isKnownRole } from './roles.decorator';
import { UsersRepository, UserRecord } from '../users/users.repository';
import { toAuthFailure } from './auth.mapper';

export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  // Baris users terkini; dipakai endpoint yang butuh profil lengkap tanpa
  // query ulang.
  account?: UserRecord;
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

// Guard ini memverifikasi tanda tangan token SEKALIGUS membaca status akun
// terkini dari database. Konsekuensinya: role dan status aktif selalu
// otoritatif dari DB, bukan dari klaim token yang bisa berumur 8 jam.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(req);

    if (!token) {
      throw new UnauthorizedException('Tidak ada token autentikasi');
    }

    let payload: JwtPayload;
    try {
      payload = (await this.authService.verifyToken(token)) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Token tidak valid atau sudah kedaluwarsa');
    }

    if (this.authService.isTokenRevoked(token)) {
      throw new UnauthorizedException('Sesi telah diakhiri (token dicabut)');
    }

    // Token bertanda tangan sah tapi membawa role di luar daftar yang dikenal
    // berarti identitasnya tidak dapat dipercaya. Tolak sebelum masuk controller.
    if (!isKnownRole(payload.role)) {
      throw new ForbiddenException('Role pada token tidak dikenali');
    }

    // Status akun terkini. Kegagalan database → 503 (bukan 401) agar frontend
    // tidak menghapus sesi karena gangguan infrastruktur.
    const account = await this.users.findById(payload.sub).catch(toAuthFailure);

    if (!account) {
      throw new UnauthorizedException('Akun tidak ditemukan, silakan login kembali');
    }
    if (!account.is_active) {
      throw new UnauthorizedException('Akun Anda tidak aktif');
    }
    if (!isKnownRole(account.role)) {
      throw new ForbiddenException('Role akun tidak dikenali');
    }

    // Role dari DB menimpa klaim token: penurunan hak akses berlaku seketika.
    req.user = { sub: account.id, email: account.email, role: account.role };
    req.account = account;

    return true;
  }
}

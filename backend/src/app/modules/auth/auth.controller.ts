import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Get,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const { email, password } = loginDto;
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Email atau password salah');
    }
    return this.authService.login(user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request) {
    const token = extractBearerToken(req);
    if (token) {
      this.authService.revokeToken(token);
    }
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('Tidak ada token autentikasi');
    }
    try {
      const payload = await this.authService.decodeToken(token);
      if (this.authService.isTokenRevoked(token)) {
        throw new UnauthorizedException('Token telah dicabut. Silakan login kembali.');
      }
      return this.authService.getCurrentUser(payload.email);
    } catch {
      throw new UnauthorizedException('Token tidak valid');
    }
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Body()
    body: {
      name?: string;
      phone?: string;
      address?: string;
    },
    @Req() req: Request,
  ) {
    const authenticatedEmail = (req as any).user?.email;
    if (!authenticatedEmail) {
      return { error: 'Tidak dapat mengakses profil' };
    }
    // Hanya boleh meng-update profil AKUN yang sedang login.
    // Email di body diabaikan agar tidak bisa berpindah akun (account takeover).
    const user = this.authService.updateProfile(authenticatedEmail, {
      name: body.name,
      phone: body.phone,
      address: body.address,
    });
    if (!user) {
      return { error: 'Pengguna tidak ditemukan' };
    }
    return { ok: true, user };
  }

  @Post('password')
  @UseGuards(JwtAuthGuard)
  async updatePassword(
    @Body()
    body: {
      currentPassword: string;
      newPassword: string;
    },
    @Req() req: Request,
  ) {
    const authenticatedEmail = (req as any).user?.email;
    if (!authenticatedEmail) {
      return { error: 'Tidak dapat mengakses' };
    }
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      return { error: 'Password saat ini dan password baru wajib diisi' };
    }
    const success = this.authService.updatePassword(
      authenticatedEmail,
      currentPassword,
      newPassword,
    );
    if (!success) {
      throw new UnauthorizedException('Gagal update password (password saat ini mungkin salah)');
    }
    return { ok: true };
  }
}

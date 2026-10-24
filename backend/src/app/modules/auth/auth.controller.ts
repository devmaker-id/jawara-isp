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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard, AuthenticatedRequest } from './auth.guard';
import { toPublicUser } from './auth.mapper';
import { LoginRateLimitService } from './login-rate-limit.service';
import * as crypto from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Use fixed absolute path for uploads (compiled dist directory)
const UPLOAD_DIR = '/home/devmaker/jawara-isp/backend/dist/uploads';
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o755 });
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

// IP klien untuk pembatas login. Hanya `cf-connecting-ip` yang dipercaya:
// header itu ditulis ulang oleh Cloudflare. `x-forwarded-for` sengaja TIDAK
// dipakai karena tanpa `trust proxy` nilainya bisa dipalsukan klien, sehingga
// pembatas bisa dilewati dengan mengganti header setiap percobaan.
function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  const raw = Array.isArray(cf) ? cf[0] : cf;
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || req.ip || 'unknown';
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private rateLimit: LoginRateLimitService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const { email, password } = loginDto;
    const ip = clientIp(req);

    // Diperiksa sebelum kredensial agar percobaan ke-6 tidak menyentuh hashing.
    this.rateLimit.assertAllowed(ip, email);

    // validateUser melempar ServiceUnavailableException bila database bermasalah.
    // Exception itu sengaja tidak ditangkap: kegagalan infrastruktur bukan
    // percobaan kredensial, jadi tidak boleh menambah hitungan rate limit.
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      this.rateLimit.recordFailure(ip, email);
      throw new UnauthorizedException('Email atau password salah');
    }

    this.rateLimit.recordSuccess(ip, email);
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
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    // Guard sudah memverifikasi token DAN membaca akun terkini dari database.
    const account = (req as AuthenticatedRequest).account;
    if (!account) {
      throw new UnauthorizedException('Sesi tidak valid');
    }
    return toPublicUser(account);
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
    const user = await this.authService.updateProfile(authenticatedEmail, {
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
      confirmPassword?: string;
    },
    @Req() req: Request,
  ) {
    const authenticatedEmail = (req as any).user?.email;
    if (!authenticatedEmail) {
      return { error: 'Tidak dapat mengakses' };
    }
    const { currentPassword, newPassword, confirmPassword } = body;
    if (!currentPassword || !newPassword) {
      return { error: 'Password saat ini dan password baru wajib diisi' };
    }
    // Validasi konfirmasi password
    if (newPassword !== confirmPassword) {
      return { error: 'Password baru dan konfirmasi tidak cocok' };
    }
    if (newPassword.length < 6) {
      return { error: 'Password minimal 6 karakter' };
    }
    const success = await this.authService.updatePassword(
      authenticatedEmail,
      currentPassword,
      newPassword,
    );
    if (!success) {
      throw new UnauthorizedException('Gagal update password (password saat ini mungkin salah)');
    }
    return { ok: true };
  }

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(
    @UploadedFile() file: any,
    @Req() req: Request,
  ) {
    const authenticatedEmail = (req as any).user?.email;
    if (!authenticatedEmail) {
      return { error: 'Tidak dapat mengakses' };
    }

    if (!file) {
      return { error: 'Tidak ada file yang diupload' };
    }

    // Validasi tipe file (hanya gambar)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return { error: 'Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.' };
    }

    // Validasi ukuran file (maks 2MB = 2 * 1024 * 1024 bytes)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      return { error: 'Ukuran file maksimal 2 MB.' };
    }

    // Generate unique filename
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `${authenticatedEmail}_${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const filePath = join(UPLOAD_DIR, filename);

    // Simpan file
    writeFileSync(filePath, file.buffer);

    // Update user avatar URL
    const user = await this.authService.updateAvatar(authenticatedEmail, `/uploads/${filename}`);
    if (!user) {
      return { error: 'Pengguna tidak ditemukan' };
    }

    // Kolom avatar belum ada di skema, jadi file tersimpan tetapi tidak dapat
    // direferensikan ulang. Laporkan apa adanya, jangan mengaku berhasil.
    return {
      ok: false,
      error: 'Penyimpanan foto profil belum aktif. Fitur ini menunggu migrasi kolom avatar.',
    };
  }
}

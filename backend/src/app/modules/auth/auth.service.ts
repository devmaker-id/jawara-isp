import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../config/config.service';
import { UsersRepository, UserRecord } from '../users/users.repository';
import { PasswordService } from './password.service';
import { toAuthFailure, toPublicUser, PublicUser } from './auth.mapper';

export type { PublicUser };

// Autentikasi memakai SATU sumber: tabel `users`. Tidak ada fallback ke akun
// in-memory — bila database tidak dapat diakses, login gagal dengan 503.
@Injectable()
export class AuthService {
  // Blacklist token (logout). Masih di memori proses; hilang saat restart.
  private revokedTokens = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * @throws ServiceUnavailableException bila database bermasalah
   * @returns null untuk email tidak terdaftar, password salah, atau akun nonaktif
   */
  async validateUser(email: string, password: string): Promise<UserRecord | null> {
    const user = await this.users.findByEmail(email).catch(toAuthFailure);

    if (!user) {
      // Tabel kosong = belum dikonfigurasi, bukan kredensial salah.
      const total = await this.users.countAll().catch(toAuthFailure);
      if (total === 0) {
        throw new ServiceUnavailableException(
          'Akun belum dikonfigurasi. Hubungi administrator sistem.',
        );
      }
      return null;
    }

    const result = await this.passwords.verify(password, user.password_hash);
    if (!result.ok) return null;
    if (!user.is_active) return null;

    // Hash lama (SHA-256) atau cost rendah dinaikkan diam-diam setelah login sah.
    if (result.needsRehash) {
      const hash = await this.passwords.hash(password);
      await this.users.update(user.id, { password_hash: hash }).catch(() => {
        // Gagal rehash tidak boleh menggagalkan login yang sudah valid.
      });
    }

    return user;
  }

  async login(user: UserRecord) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      token: this.jwtService.sign(payload, {
        secret: this.configService.jwtSecret,
        // 8 jam: satu shift kerja. Guard membaca role/status terkini dari DB,
        // jadi perubahan role berlaku tanpa menunggu token kedaluwarsa.
        expiresIn: '8h',
      }),
      user: toPublicUser(user),
    };
  }

  verifyToken(token: string): Promise<unknown> {
    return this.jwtService.verifyAsync(token, { secret: this.configService.jwtSecret });
  }

  isTokenRevoked(token: string): boolean {
    return this.revokedTokens.has(token);
  }

  revokeToken(token: string): void {
    this.revokedTokens.add(token);
  }

  async getCurrentUser(email: string): Promise<PublicUser | null> {
    const user = await this.users.findByEmail(email).catch(toAuthFailure);
    return user ? toPublicUser(user) : null;
  }

  async updateProfile(
    email: string,
    data: { name?: string; phone?: string; address?: string },
  ): Promise<PublicUser | null> {
    const user = await this.users.findByEmail(email).catch(toAuthFailure);
    if (!user) return null;

    const updated = await this.users
      .update(user.id, {
        name: data.name,
        phone: data.phone,
        address: data.address,
      })
      .catch(toAuthFailure);

    return updated ? toPublicUser(updated) : null;
  }

  // Kolom avatar belum ada di skema. Perubahan hanya dikembalikan ke pemanggil,
  // tidak disimpan — menghindari klaim tersimpan padahal tidak.
  async updateAvatar(email: string, avatar: string): Promise<PublicUser | null> {
    const user = await this.users.findByEmail(email).catch(toAuthFailure);
    if (!user) return null;
    return toPublicUser(user);
  }

  async updatePassword(
    email: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const user = await this.users.findByEmail(email).catch(toAuthFailure);
    if (!user) return false;

    const current = await this.passwords.verify(currentPassword, user.password_hash);
    if (!current.ok) return false;

    const hash = await this.passwords.hash(newPassword);
    await this.users.update(user.id, { password_hash: hash }).catch(toAuthFailure);
    return true;
  }
}

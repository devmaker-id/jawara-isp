import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../config/config.service';
import * as crypto from 'crypto';

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'operator' | 'resseler';
  phone?: string;
  address?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const users: User[] = [
  {
    id: 1,
    name: 'Administrator',
    email: 'admin@jawara-billing.com',
    password_hash: crypto.createHash('sha256').update('password123').digest('hex'),
    role: 'admin',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
];

// Blacklist token (logout). Hanya berlaku dalam proses ini; untuk produksi
// dipindah ke store bersama (mis. Redis atau tabel revoked_tokens di MySQL).
@Injectable()
export class AuthService {
  private revokedTokens = new Set<string>();

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  validateUser(email: string, password: string): Promise<User | null> {
    const user = users.find((u) => u.email === email);
    if (!user) {
      return Promise.resolve(null);
    }
    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    if (inputHash !== user.password_hash) {
      return Promise.resolve(null);
    }
    if (!user.is_active) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...user });
  }

  async login(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      token: this.jwtService.sign(payload, {
        secret: this.configService.jwtSecret,
        expiresIn: '7d',
      }),
      user,
    };
  }

  decodeToken(token: string): Promise<any> {
    return this.jwtService.verify(token, { secret: this.configService.jwtSecret });
  }

  async verifyToken(token: string): Promise<any> {
    return this.jwtService.verifyAsync(token, {
      secret: this.configService.jwtSecret,
    });
  }

  isTokenRevoked(token: string): boolean {
    return this.revokedTokens.has(token);
  }

  revokeToken(token: string): void {
    this.revokedTokens.add(token);
  }

  getCurrentUser(email: string): User | null {
    return users.find((u) => u.email === email) ?? null;
  }

  updateProfile(email: string, data: { name?: string; phone?: string; address?: string }): User | null {
    const user = users.find((u) => u.email === email);
    if (!user) return null;
    if (data.name !== undefined) user.name = data.name;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.address !== undefined) user.address = data.address;
    return { ...user };
  }

  updatePassword(email: string, currentPassword: string, newPassword: string): boolean {
    const user = users.find((u) => u.email === email);
    if (!user) return false;
    const inputHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (inputHash !== user.password_hash) return false;
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    user.password_hash = newHash;
    return true;
  }
}

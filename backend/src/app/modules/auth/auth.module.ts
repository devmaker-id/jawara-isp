import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolesGuard } from './roles.guard';
import { PasswordService } from './password.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { ConfigService } from '../../config/config.service';

// Secret wajib dari environment; fallback lama ('dev-jwt-secret-change-me')
// dihapus. Dibaca lewat useFactory karena `register()` statis dievaluasi
// SEBELUM ConfigModule memuat .env, sehingga secret selalu kosong di titik itu.
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error('JWT_SECRET wajib diisi pada environment backend/.env');
  }
  return secret;
}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret(),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ConfigService, RolesGuard, PasswordService, LoginRateLimitService],
  exports: [AuthService, RolesGuard, PasswordService],
})
export class AuthModule {}

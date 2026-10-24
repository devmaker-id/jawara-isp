import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'crypto';

const BCRYPT_COST = 12;
const LEGACY_SHA256 = /^[a-f0-9]{64}$/i;

export interface VerifyResult {
  ok: boolean;
  // true bila hash masih format lama dan sebaiknya ditulis ulang ke bcrypt.
  needsRehash: boolean;
}

// Satu-satunya tempat hashing password. Hash baru SELALU bcrypt cost 12;
// SHA-256 hanya dipakai untuk memverifikasi hash lama (jalur transisi),
// tidak pernah untuk membuat hash baru.
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  async verify(plain: string, stored: string): Promise<VerifyResult> {
    if (!stored) return { ok: false, needsRehash: false };

    // Jalur legacy: hash SHA-256 tanpa salt dari implementasi sebelumnya.
    if (LEGACY_SHA256.test(stored)) {
      const computed = createHash('sha256').update(plain).digest();
      const expected = Buffer.from(stored, 'hex');
      const ok =
        computed.length === expected.length && timingSafeEqual(computed, expected);
      return { ok, needsRehash: ok };
    }

    if (isBcryptHash(stored)) {
      const ok = await bcrypt.compare(plain, stored);
      return { ok, needsRehash: ok && needsUpgrade(stored) };
    }

    return { ok: false, needsRehash: false };
  }

  isLegacyHash(stored: string): boolean {
    return LEGACY_SHA256.test(stored);
  }
}

function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

// Cost di bawah standar saat ini (12) → hash perlu dinaikkan.
function needsUpgrade(value: string): boolean {
  const cost = Number(value.split('$')[2]);
  return Number.isFinite(cost) && cost < BCRYPT_COST;
}

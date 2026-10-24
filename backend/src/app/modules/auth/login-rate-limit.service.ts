import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IDENTITY = 5;
// Batas kasar per IP untuk mencegah percobaan menyebar ke banyak akun.
const MAX_PER_IP = 20;

interface Bucket {
  count: number;
  resetAt: number;
}

// Pembatas percobaan login di memori proses. Cukup untuk satu instance;
// bila backend dijalankan lebih dari satu instance, pindahkan ke Redis.
@Injectable()
export class LoginRateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  // Normalisasi: trim + lowercase. Mencegah bypass lewat variasi kapitalisasi
  // atau spasi pada email yang sama.
  static normalizeIdentity(email: string): string {
    return email.trim().toLowerCase();
  }

  private hit(key: string, limit: number): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      // Jendela baru: mulai dari 1, tidak pernah melempar di sini.
      this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      throw this.tooMany(bucket.resetAt);
    }
  }

  private tooMany(resetAt: number): HttpException {
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: `Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // Dipanggil SEBELUM memeriksa kredensial. Melempar 429 bila kuota habis.
  assertAllowed(ip: string, email: string): void {
    this.prune();
    const identity = LoginRateLimitService.normalizeIdentity(email);
    const identityBucket = this.buckets.get(`${ip}|${identity}`);
    const ipBucket = this.buckets.get(ip);

    const now = Date.now();
    if (identityBucket && identityBucket.resetAt > now && identityBucket.count >= MAX_PER_IDENTITY) {
      throw this.tooMany(identityBucket.resetAt);
    }
    if (ipBucket && ipBucket.resetAt > now && ipBucket.count >= MAX_PER_IP) {
      throw this.tooMany(ipBucket.resetAt);
    }
  }

  // Dicatat hanya untuk percobaan yang gagal, agar pengguna sah tidak
  // terkunci karena berhasil login berkali-kali.
  recordFailure(ip: string, email: string): void {
    const identity = LoginRateLimitService.normalizeIdentity(email);
    this.hit(`${ip}|${identity}`, MAX_PER_IDENTITY);
    this.hit(ip, MAX_PER_IP);
  }

  recordSuccess(ip: string, email: string): void {
    const identity = LoginRateLimitService.normalizeIdentity(email);
    this.buckets.delete(`${ip}|${identity}`);
  }

  // Dipakai test agar tiap kasus mulai dari kondisi bersih.
  reset(): void {
    this.buckets.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

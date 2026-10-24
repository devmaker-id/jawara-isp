import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/app/modules/auth/auth.service';

describe('AuthService public user responses', () => {
  const authService = new AuthService(
    { jwtSecret: 'test-jwt-secret' } as any,
    {
      sign: () => 'test-token',
      verify: () => ({ sub: 1, email: 'admin@jawara-billing.com', role: 'admin' }),
      verifyAsync: async () => ({ sub: 1, email: 'admin@jawara-billing.com', role: 'admin' }),
    } as any,
  );

  it('does not expose password_hash in login responses', async () => {
    const user = await authService.validateUser('admin@jawara-billing.com', 'password123');

    expect(user).not.toBeNull();
    const response = await authService.login(user!);

    expect(response.user).not.toHaveProperty('password_hash');
  });

  it('does not expose password_hash in current-user responses', () => {
    const user = authService.getCurrentUser('admin@jawara-billing.com');

    expect(user).not.toBeNull();
    expect(user).not.toHaveProperty('password_hash');
  });
});

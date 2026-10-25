import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses salted scrypt and verifies only the right password', async () => {
    const a = await hashPassword('benar-sekali-1');
    const b = await hashPassword('benar-sekali-1');
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('benar-sekali-1', a)).toBe(true);
    expect(await verifyPassword('salah-sekali-1', a)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

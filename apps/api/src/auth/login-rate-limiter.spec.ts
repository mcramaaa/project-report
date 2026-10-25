import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './login-rate-limiter';

describe('LoginRateLimiter', () => {
  it('blocks an email after the limit within the window, then expires', () => {
    let now = 0;
    const limiter = new LoginRateLimiter({ perEmail: 2, windowMs: 1000 }, () => now);

    limiter.recordFailure('a@x.id');
    expect(limiter.isBlocked('a@x.id')).toBe(false);
    limiter.recordFailure('a@x.id');
    expect(limiter.isBlocked('a@x.id')).toBe(true);
    expect(limiter.isBlocked('b@x.id')).toBe(false);

    now = 1000;
    expect(limiter.isBlocked('a@x.id')).toBe(false);
  });

  it('reset clears the email bucket after a successful login', () => {
    const limiter = new LoginRateLimiter({ perEmail: 1, windowMs: 1000 }, () => 0);
    limiter.recordFailure('a@x.id');
    limiter.reset('a@x.id');
    expect(limiter.isBlocked('a@x.id')).toBe(false);
  });
});

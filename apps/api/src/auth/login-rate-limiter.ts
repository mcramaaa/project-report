interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimits {
  perEmail: number;
  windowMs: number;
}

/**
 * Counts failed logins per normalized email (D-030).
 * No per-IP limit: behind the apps/web rewrite every request comes from the proxy and the
 * forwarded client IP is client-controlled, so an IP key is either spoofable or global.
 * shortcut: in-memory and per process, so limits reset on restart and are not shared;
 * move to the database or Redis before running more than one API instance, and add a per-IP
 * limit once deployment provides a trusted client IP (Milestone 16).
 */
export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limits: RateLimits = { perEmail: 5, windowMs: 15 * 60 * 1000 },
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(email: string): boolean {
    return (this.live(email)?.count ?? 0) >= this.limits.perEmail;
  }

  recordFailure(email: string): void {
    if (this.buckets.size > 10_000) this.prune();
    const bucket = this.live(email) ?? { count: 0, resetAt: this.now() + this.limits.windowMs };
    bucket.count += 1;
    this.buckets.set(email, bucket);
  }

  reset(email: string): void {
    this.buckets.delete(email);
  }

  private live(email: string): Bucket | undefined {
    const bucket = this.buckets.get(email);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(email);
      return undefined;
    }
    return bucket;
  }

  private prune(): void {
    for (const key of [...this.buckets.keys()]) this.live(key);
  }
}

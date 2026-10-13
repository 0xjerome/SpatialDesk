// @ts-check
/** Fixed-window per-key rate limiter kept in memory (single process). */
export class RateLimiter {
  /**
   * @param {{ limit: number, windowMs: number, now?: () => number }} options
   */
  constructor(options) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.buckets = new Map();
  }

  /**
   * @param {string} key
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
   */
  hit(key) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    if (this.buckets.size > 10_000) this.sweep(now);
    if (bucket.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
    }
    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterMs: 0 };
  }

  /** @param {number} now */
  sweep(now) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}

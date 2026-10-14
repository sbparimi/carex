export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  sweep(): void;
  size(): number;
}

interface Entry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000, now = Date.now } = opts;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("windowMs must be a positive number");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("maxKeys must be a positive integer");

  const entries = new Map<string, Entry>();

  const retryAfter = (resetAt: number, t: number) => Math.max(1, Math.ceil((resetAt - t) / 1000));

  const sweep = () => {
    const t = now();
    for (const [k, e] of entries) if (e.resetAt <= t) entries.delete(k);
  };

  const check = (key: string): RateLimitResult => {
    const t = now();
    let e = entries.get(key);
    if (e && e.resetAt <= t) {
      entries.delete(key);
      e = undefined;
    }
    if (!e) {
      if (entries.size >= maxKeys) {
        sweep();
        if (entries.size >= maxKeys) {
          // Fail closed: do not track new keys when the table is full of live keys.
          return { allowed: false, remaining: 0, retryAfterSec: retryAfter(windowMs + t, t) };
        }
      }
      e = { count: 0, resetAt: t + windowMs };
      entries.set(key, e);
    }
    if (e.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterSec: retryAfter(e.resetAt, t) };
    }
    e.count += 1;
    return { allowed: true, remaining: limit - e.count, retryAfterSec: 0 };
  };

  return { check, sweep, size: () => entries.size };
}

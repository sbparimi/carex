// Owner-approved spec for the rate limiter. Workers implement apps/api/src/ratelimit.ts; they may not edit this file.
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../src/ratelimit.js";

const clock = (start = 1_000_000) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

describe("rate limiter (fixed window, per key)", () => {
  it("allows up to the limit, reports remaining, then denies", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: c.now });
    expect(rl.check("a")).toMatchObject({ allowed: true, remaining: 2 });
    expect(rl.check("a")).toMatchObject({ allowed: true, remaining: 1 });
    expect(rl.check("a")).toMatchObject({ allowed: true, remaining: 0 });
    expect(rl.check("a")).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("tells the caller how long to wait (whole seconds, rounded up, at least 1)", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now });
    rl.check("a");
    c.advance(10_500);
    expect(rl.check("a")).toMatchObject({ allowed: false, retryAfterSec: 50 });
    c.advance(49_999);
    expect(rl.check("a")).toMatchObject({ allowed: false, retryAfterSec: 1 });
  });

  it("keeps keys independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock().now });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("starts a fresh window after the window elapses", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    rl.check("a");
    expect(rl.check("a").allowed).toBe(false);
    c.advance(1000);
    expect(rl.check("a")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("does not extend the window when a request is denied", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    rl.check("a");
    c.advance(900);
    rl.check("a");                       // denied
    c.advance(100);                      // original window is now over
    expect(rl.check("a").allowed).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ limit: 1.5, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
    expect(() => createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 0 })).toThrow();
  });

  it("sweep() drops expired keys so memory stays bounded", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    rl.check("a"); rl.check("b");
    expect(rl.size()).toBe(2);
    c.advance(1000);
    rl.check("c");
    rl.sweep();
    expect(rl.size()).toBe(1);
  });

  it("fails closed when the table is full of live keys, and recovers once keys expire", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 2, now: c.now });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("c")).toMatchObject({ allowed: false });     // new key refused, not silently tracked
    expect(rl.check("a").allowed).toBe(true);                    // existing keys still work
    c.advance(1000);
    expect(rl.check("c").allowed).toBe(true);                    // expired keys were evicted to make room
  });
});

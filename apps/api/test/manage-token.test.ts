// Owner-approved spec for apps/api/src/manage-token.ts: unforgeable, stateless "manage this appointment" tokens for guests (ADR-003).
import { describe, it, expect } from "vitest";
import { issueManageToken, verifyManageToken } from "../src/manage-token.js";

const SECRET = "test-secret-test-secret-test-secret-0123";
const OTHER = "other-secret-other-secret-other-secret-9";

describe("manage tokens", () => {
  it("are deterministic for the same inputs, URL-safe, and 43 characters (256 bits)", () => {
    const a = issueManageToken(SECRET, "tn-north", "CX-AAAA-BBBB");
    expect(a).toBe(issueManageToken(SECRET, "tn-north", "CX-AAAA-BBBB"));
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("differ per tenant, per booking and per secret", () => {
    const base = issueManageToken(SECRET, "tn-north", "CX-AAAA-BBBB");
    expect(issueManageToken(SECRET, "tn-bay", "CX-AAAA-BBBB")).not.toBe(base);
    expect(issueManageToken(SECRET, "tn-north", "CX-AAAA-BBBC")).not.toBe(base);
    expect(issueManageToken(OTHER, "tn-north", "CX-AAAA-BBBB")).not.toBe(base);
  });
  it("cannot be confused by ambiguous concatenation of tenant and booking", () => {
    expect(issueManageToken(SECRET, "ab", "c")).not.toBe(issueManageToken(SECRET, "a", "bc"));
  });
  it("verify only the exact token for the exact tenant and booking", () => {
    const t = issueManageToken(SECRET, "tn-north", "CX-AAAA-BBBB");
    expect(verifyManageToken(SECRET, "tn-north", "CX-AAAA-BBBB", t)).toBe(true);
    expect(verifyManageToken(SECRET, "tn-bay", "CX-AAAA-BBBB", t)).toBe(false);
    expect(verifyManageToken(SECRET, "tn-north", "CX-AAAA-BBBC", t)).toBe(false);
    expect(verifyManageToken(OTHER, "tn-north", "CX-AAAA-BBBB", t)).toBe(false);
    expect(verifyManageToken(SECRET, "tn-north", "CX-AAAA-BBBB", t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe(false);
  });
  it("never throw on malformed input", () => {
    for (const bad of [undefined, null, "", "short", "x".repeat(500), "%%%%", 42 as unknown as string]) {
      expect(verifyManageToken(SECRET, "tn-north", "CX-AAAA-BBBB", bad as string | undefined)).toBe(false);
    }
  });
  it("refuse to issue tokens with a weak secret", () => {
    expect(() => issueManageToken("short", "tn-north", "CX-AAAA-BBBB")).toThrow();
    expect(() => issueManageToken("", "tn-north", "CX-AAAA-BBBB")).toThrow();
  });
});

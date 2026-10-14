// Owner-approved spec for apps/api/src/zoned.ts (time-zone maths with Intl, no dependencies).
import { describe, it, expect } from "vitest";
import { zonedTimeToUtc, localParts } from "../src/zoned.js";

const iso = (d: Date | undefined) => d?.toISOString();

describe("zonedTimeToUtc(year, month, day, minuteOfDay, timeZone)", () => {
  it("converts summer and winter local times using the right offset", () => {
    expect(iso(zonedTimeToUtc(2026, 7, 1, 9 * 60, "America/Los_Angeles"))).toBe("2026-07-01T16:00:00.000Z");
    expect(iso(zonedTimeToUtc(2026, 1, 15, 9 * 60, "America/Los_Angeles"))).toBe("2026-01-15T17:00:00.000Z");
    expect(iso(zonedTimeToUtc(2026, 10, 14, 10 * 60, "America/Chicago"))).toBe("2026-10-14T15:00:00.000Z");
  });
  it("handles zones with half-hour offsets and no DST", () => {
    expect(iso(zonedTimeToUtc(2026, 10, 14, 9 * 60, "Asia/Kolkata"))).toBe("2026-10-14T03:30:00.000Z");
    expect(iso(zonedTimeToUtc(2026, 10, 14, 9 * 60, "UTC"))).toBe("2026-10-14T09:00:00.000Z");
  });
  it("returns undefined for a local time that does not exist (spring-forward gap)", () => {
    expect(zonedTimeToUtc(2026, 3, 8, 2 * 60 + 30, "America/Los_Angeles")).toBeUndefined();
    expect(iso(zonedTimeToUtc(2026, 3, 8, 3 * 60, "America/Los_Angeles"))).toBe("2026-03-08T10:00:00.000Z");
  });
  it("uses the first occurrence for an ambiguous local time (fall-back overlap)", () => {
    expect(iso(zonedTimeToUtc(2026, 11, 1, 1 * 60 + 30, "America/Los_Angeles"))).toBe("2026-11-01T08:30:00.000Z");
    expect(iso(zonedTimeToUtc(2026, 11, 1, 2 * 60, "America/Los_Angeles"))).toBe("2026-11-01T10:00:00.000Z");
  });
  it("rejects an unknown time zone", () => {
    expect(() => zonedTimeToUtc(2026, 1, 1, 0, "Mars/Olympus")).toThrow();
  });
});

describe("localParts(instant, timeZone)", () => {
  it("returns the local calendar date, weekday (0 = Sunday) and minute of day", () => {
    expect(localParts(new Date("2026-10-14T16:00:00Z"), "America/Los_Angeles")).toEqual({ year: 2026, month: 10, day: 14, weekday: 3, minuteOfDay: 9 * 60 });
  });
  it("crosses the date line correctly", () => {
    expect(localParts(new Date("2026-10-15T03:00:00Z"), "America/Los_Angeles")).toEqual({ year: 2026, month: 10, day: 14, weekday: 3, minuteOfDay: 20 * 60 });
    expect(localParts(new Date("2026-10-14T23:30:00Z"), "Asia/Kolkata")).toEqual({ year: 2026, month: 10, day: 15, weekday: 4, minuteOfDay: 5 * 60 });
  });
  it("represents midnight as minute 0 (not 1440)", () => {
    expect(localParts(new Date("2026-10-14T07:00:00Z"), "America/Los_Angeles").minuteOfDay).toBe(0);
  });
});

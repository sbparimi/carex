import { describe, it, expect } from "vitest";
import { safeBrand, contrast } from "../src/theme.js";

describe("tenant brand contrast guardrail", () => {
  it("keeps accessible colours unchanged", () => { expect(safeBrand("#0b5fff")).toBe("#0b5fff"); });
  it("darkens a low-contrast brand colour until white text passes AA", () => {
    for (const bad of ["#ffff00", "#aaddff", "#f4d35e", "#cccccc"]) { const c = safeBrand(bad); expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(4.5); }
  });
  it("falls back to a safe default for malformed input", () => { expect(safeBrand("javascript:alert(1)")).toBe("#0b5fff"); expect(safeBrand("red")).toBe("#0b5fff"); });
});

// Owner-approved spec for apps/api/src/sqlite-catalog.ts. Same contract as the in-memory catalog: tenant isolation is a property of the class.
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, seedDb } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { SqliteCatalog } from "../src/sqlite-catalog.js";

let c: SqliteCatalog;
beforeEach(() => { const db = openDb(); seedDb(db, syntheticCatalog()); c = new SqliteCatalog(db); });

describe("SqliteCatalog", () => {
  it("resolves active tenants by slug, with brand and the analytics switch", () => {
    expect(c.tenantBySlug("northwind-health")).toMatchObject({ id: "tn-north", slug: "northwind-health", analyticsEnabled: true, brand: { displayName: "Northwind Health (synthetic)", primaryColor: "#0b5fff" } });
    expect(c.tenantBySlug("bayview-care")?.analyticsEnabled).toBe(false);
  });
  it("does not resolve suspended, unknown or empty slugs", () => {
    expect(c.tenantBySlug("dormant-clinic")).toBeUndefined();
    expect(c.tenantBySlug("nope")).toBeUndefined();
    expect(c.tenantBySlug("")).toBeUndefined();
  });
  it("lists only states with an active, bookable clinic, per tenant", () => {
    expect(c.states("tn-north")).toEqual(["CA", "TX"]);
    expect(c.states("tn-bay")).toEqual(["CA"]);
    expect(c.states("tn-off")).toEqual([]);
    expect(c.states("tn-unknown")).toEqual([]);
  });
  it("lists clinics for the tenant and state only, sorted by name, without internal fields", () => {
    expect(c.clinics("tn-north", "CA")).toEqual([{ id: "cl-sb", name: "San Bernardo Clinic", city: "San Bernardo", address: "1 Example Way, San Bernardo", stateCode: "CA", timeZone: "America/Los_Angeles" }]);
    expect(c.clinics("tn-bay", "CA").map((x) => x.id)).toEqual(["cl-oak"]);
    expect(c.clinics("tn-north", "NY")).toEqual([]);
  });
  it("does not return clinics across tenants, or inactive ones", () => {
    expect(c.clinic("tn-bay", "cl-sb")).toBeUndefined();
    expect(c.clinic("tn-north", "cl-fr")).toBeUndefined();
    expect(c.clinic("tn-north", "cl-nb")).toBeUndefined();
    expect(c.clinic("tn-north", "cl-sb")?.name).toBe("San Bernardo Clinic");
  });
  it("offers only visit types switched on at that clinic, sorted by label", () => {
    expect(c.visitTypes("tn-north", "cl-sb").map((v) => v.id)).toEqual(["sv-pc-n", "sv-physio-n"]);
    expect(c.visitTypes("tn-north", "cl-sb")[0]).toEqual({ id: "sv-pc-n", canonicalType: "primary_care", label: "Primary Care", description: "Primary Care visit" });
    expect(c.visitTypes("tn-bay", "cl-sb")).toEqual([]);
    expect(c.visitTypes("tn-north", "cl-fr")).toEqual([]);
  });
  it("offers only active, eligible providers", () => {
    expect(c.providers("tn-north", "cl-sb", "sv-pc-n")).toEqual([{ id: "pr-a", displayName: "Dr. Alex Example" }]);
    expect(c.providers("tn-north", "cl-sb", "sv-vision-n")).toEqual([]);
    expect(c.providers("tn-bay", "cl-sb", "sv-pc-n")).toEqual([]);
  });
  it("checks the whole eligibility chain and nothing leaks across tenants", () => {
    expect(c.eligible("tn-north", "cl-sb", "sv-pc-n", "pr-a")).toMatchObject({ clinic: { id: "cl-sb" }, visitType: { id: "sv-pc-n" }, provider: { id: "pr-a" } });
    expect(c.eligible("tn-north", "cl-sb", "sv-pc-n", "pr-gone")).toBeUndefined();
    expect(c.eligible("tn-north", "cl-sb", "sv-physio-n", "pr-a")).toBeUndefined();
    expect(c.eligible("tn-bay", "cl-sb", "sv-pc-n", "pr-a")).toBeUndefined();
    expect(c.eligible("tn-north", "cl-oak", "sv-pc-b", "pr-z")).toBeUndefined();
  });
  it("is safe against SQL injection in identifiers", () => {
    expect(c.tenantBySlug("x' OR '1'='1")).toBeUndefined();
    expect(c.clinics("tn-north", "CA' OR '1'='1")).toEqual([]);
    expect(c.clinic("tn-north' OR '1'='1", "cl-sb")).toBeUndefined();
  });
});

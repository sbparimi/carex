// Owner-approved spec for apps/api/src/db-catalog.ts. Same contract as the in-memory catalog: tenant isolation is a property of the class.
import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, seedDb } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { DbCatalog } from "../src/db-catalog.js";

let c: DbCatalog;
beforeEach(async () => { const db = await openTestDb(); await seedDb(db, syntheticCatalog()); c = new DbCatalog(db); });

describe("DbCatalog", () => {
  it("resolves active tenants by slug, with brand and the analytics switch", async () => {
    expect(await c.tenantBySlug("northwind-health")).toMatchObject({ id: "tn-north", slug: "northwind-health", analyticsEnabled: true, brand: { displayName: "Northwind Health (synthetic)", primaryColor: "#0b5fff" } });
    expect((await c.tenantBySlug("bayview-care"))?.analyticsEnabled).toBe(false);
  });
  it("does not resolve suspended, unknown or empty slugs", async () => {
    expect(await c.tenantBySlug("dormant-clinic")).toBeUndefined();
    expect(await c.tenantBySlug("nope")).toBeUndefined();
    expect(await c.tenantBySlug("")).toBeUndefined();
  });
  it("lists only states with an active, bookable clinic, per tenant", async () => {
    expect(await c.states("tn-north")).toEqual(["CA", "TX"]);
    expect(await c.states("tn-bay")).toEqual(["CA"]);
    expect(await c.states("tn-off")).toEqual([]);
    expect(await c.states("tn-unknown")).toEqual([]);
  });
  it("lists clinics for the tenant and state only, sorted by name, without internal fields", async () => {
    expect(await c.clinics("tn-north", "CA")).toEqual([{ id: "cl-sb", name: "San Bernardo Clinic", city: "San Bernardo", address: "1 Example Way, San Bernardo", stateCode: "CA", timeZone: "America/Los_Angeles" }]);
    expect((await c.clinics("tn-bay", "CA")).map((x) => x.id)).toEqual(["cl-oak"]);
    expect(await c.clinics("tn-north", "NY")).toEqual([]);
  });
  it("does not return clinics across tenants, or inactive ones", async () => {
    expect(await c.clinic("tn-bay", "cl-sb")).toBeUndefined();
    expect(await c.clinic("tn-north", "cl-fr")).toBeUndefined();
    expect(await c.clinic("tn-north", "cl-nb")).toBeUndefined();
    expect((await c.clinic("tn-north", "cl-sb"))?.name).toBe("San Bernardo Clinic");
  });
  it("offers only visit types switched on at that clinic, sorted by label", async () => {
    expect((await c.visitTypes("tn-north", "cl-sb")).map((v) => v.id)).toEqual(["sv-physio-n", "sv-pc-n"]);
    expect((await c.visitTypes("tn-north", "cl-sb"))[1]).toEqual({ id: "sv-pc-n", canonicalType: "primary_care", label: "Primary Care", description: "Primary Care visit" });
    expect(await c.visitTypes("tn-bay", "cl-sb")).toEqual([]);
    expect(await c.visitTypes("tn-north", "cl-fr")).toEqual([]);
  });
  it("offers only active, eligible providers", async () => {
    expect(await c.providers("tn-north", "cl-sb", "sv-pc-n")).toEqual([{ id: "pr-a", displayName: "Dr. Alex Example" }]);
    expect(await c.providers("tn-north", "cl-sb", "sv-vision-n")).toEqual([]);
    expect(await c.providers("tn-bay", "cl-sb", "sv-pc-n")).toEqual([]);
  });
  it("checks the whole eligibility chain and nothing leaks across tenants", async () => {
    expect(await c.eligible("tn-north", "cl-sb", "sv-pc-n", "pr-a")).toMatchObject({ clinic: { id: "cl-sb" }, visitType: { id: "sv-pc-n" }, provider: { id: "pr-a" } });
    expect(await c.eligible("tn-north", "cl-sb", "sv-pc-n", "pr-gone")).toBeUndefined();
    expect(await c.eligible("tn-north", "cl-sb", "sv-physio-n", "pr-a")).toBeUndefined();
    expect(await c.eligible("tn-bay", "cl-sb", "sv-pc-n", "pr-a")).toBeUndefined();
    expect(await c.eligible("tn-north", "cl-oak", "sv-pc-b", "pr-z")).toBeUndefined();
  });
  it("is safe against SQL injection in identifiers", async () => {
    expect(await c.tenantBySlug("x' OR '1'='1")).toBeUndefined();
    expect(await c.clinics("tn-north", "CA' OR '1'='1")).toEqual([]);
    expect(await c.clinic("tn-north' OR '1'='1", "cl-sb")).toBeUndefined();
  });
});

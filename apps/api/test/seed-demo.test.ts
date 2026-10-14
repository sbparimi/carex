import { describe, it, expect } from "vitest";
import { openTestDb, seedDb } from "../src/db.js";
import { demoCatalog, seedDemoPatients, DEMO_PASSWORD } from "../src/seed-demo.js";
import { Accounts } from "../src/accounts.js";
import { DbScheduling } from "../src/db-scheduling.js";

describe("demo data", () => {
  it("loads a rich catalog, demo accounts that can log in, and appointments; running twice changes nothing", async () => {
    const db = await openTestDb(); const now = () => new Date("2026-10-14T14:00:00Z");
    await seedDb(db, demoCatalog()); await seedDemoPatients(db, now); await seedDemoPatients(db, now);
    const accounts = new Accounts(db, now);
    expect((await accounts.employers("tn-north", "demo")).length).toBeGreaterThanOrEqual(10);
    expect((await accounts.insurers("tn-north")).length).toBeGreaterThanOrEqual(8);
    const alex = await accounts.login("tn-north", "alex.demo@example.test", DEMO_PASSWORD);
    const s = new DbScheduling(db, { now });
    const mine = await s.listForUser("tn-north", alex.profile.id);
    expect(mine.map((m) => m.status).sort()).toEqual(["cancelled", "confirmed"]);
    expect((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM users"))!.n).toBe(4);
    const states = (await db.all<{ s: string }>("SELECT DISTINCT state_code AS s FROM clinics WHERE tenant_id = 'tn-north'")).map((r) => r.s);
    expect(states).toEqual(expect.arrayContaining(["CA", "CO", "TX", "WA"]));
  });
});

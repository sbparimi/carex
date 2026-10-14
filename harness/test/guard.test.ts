import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/store.js";
import { guardCommand, ingestApprovalRequests, appendRequest } from "../src/guard.js";

const open = () => StateStore.open(join(mkdtempSync(join(tmpdir(), "g-")), "tasks.json"));

describe("guardCommand", () => {
  it("denies and requests approval once, then allows only after a human grants it", () => {
    const s = open();
    const d1 = guardCommand(s, "git push origin main", "T-a");
    expect(d1.allowed).toBe(false);
    const d2 = guardCommand(s, "git push origin main", "T-a");
    expect(d2.approvalId).toBe(d1.approvalId);                         // not duplicated
    expect(Object.keys(s.snapshot().approvals)).toHaveLength(1);
    s.decideApproval(d1.approvalId!, "granted", "suresh");
    expect(guardCommand(s, "git push origin main", "T-a").allowed).toBe(true);
    expect(guardCommand(s, "git push origin main", "T-other").allowed).toBe(false);  // approval was task-scoped
  });
  it("lets ordinary commands through without creating approvals", () => {
    const s = open();
    expect(guardCommand(s, "npm test", "T-a").allowed).toBe(true);
    expect(Object.keys(s.snapshot().approvals)).toHaveLength(0);
  });
  it("imports hook-written requests as pending, never as granted", () => {
    const s = open(); const f = join(mkdtempSync(join(tmpdir(), "g-")), "req.jsonl");
    appendRequest(f, { action: "production_deploy", reason: "production deploy", command: "vercel --prod", taskId: "T-a" });
    writeFileSync(f, "garbage\n", { flag: "a" });
    expect(ingestApprovalRequests(s, f)).toBe(1);
    expect(ingestApprovalRequests(s, f)).toBe(0);
    expect(Object.values(s.snapshot().approvals)[0]!.status).toBe("requested");
    expect(s.isAllowed("production_deploy", "T-a")).toBe(false);
  });
});

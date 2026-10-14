/**
 * HARNESS ACCEPTANCE TEST (master directive §5).
 * Feature: FR-003 clinic filtering by state and tenant. Workers are SCRIPTED agents (not live Claude);
 * everything else is real: git worktrees, scope checks, the command runner, evidence, classification,
 * review gate, approval gate, persisted state and crash/resume.
 * Set ACCEPTANCE_REPORT=<path> to write the evidence report from the actual run.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { StateStore } from "../src/store.js";
import { Orchestrator, type Reviewer } from "../src/orchestrator.js";
import { worktreeWorker, type AgentRunner } from "../src/dispatch.js";
import { makeRunnerVerifier } from "../src/runner.js";
import { guardCommand } from "../src/guard.js";
import { renderReport } from "../src/report.js";
import type { Task } from "../src/schemas.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const put = (cwd: string, rel: string, body: string) => { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), body); };

const ACCEPTANCE_TESTS = [
  'import { test } from "node:test";',
  'import assert from "node:assert";',
  'import { listClinics } from "../src/clinics.js";',
  '// Synthetic data only.',
  'const DATA = [',
  '  { id: "c1", tenantId: "t1", state: "CA", name: "San Bernardo Clinic", city: "San Bernardo", status: "active", bookable: true },',
  '  { id: "c2", tenantId: "t1", state: "CA", name: "Closed Clinic", city: "Fresno", status: "inactive", bookable: true },',
  '  { id: "c3", tenantId: "t1", state: "TX", name: "Austin Clinic", city: "Austin", status: "active", bookable: true },',
  '  { id: "c4", tenantId: "t2", state: "CA", name: "Other Tenant CA Clinic", city: "Oakland", status: "active", bookable: true },',
  '  { id: "c5", tenantId: "t1", state: "CA", name: "Not Bookable", city: "Davis", status: "active", bookable: false },',
  '];',
  'test("FR-003: lists only active, bookable clinics in the state for the tenant", () => {',
  '  assert.deepStrictEqual(listClinics(DATA, { tenantId: "t1", state: "CA" }).map((c) => c.id), ["c1"]);',
  '});',
  'test("BR-001: never returns another tenant\'s clinics", () => {',
  '  const ids = listClinics(DATA, { tenantId: "t1", state: "CA" }).map((c) => c.id);',
  '  assert.ok(!ids.includes("c4"), "leaked clinic c4 from tenant t2");',
  '});',
  'test("FR-003: empty state returns an empty list", () => {',
  '  assert.deepStrictEqual(listClinics(DATA, { tenantId: "t1", state: "NY" }), []);',
  '});',
  'test("FR-001: missing tenant is an error, never a fallback to other data", () => {',
  '  assert.throws(() => listClinics(DATA, { state: "CA" }), /tenant/i);',
  '});',
  '',
].join("\n");

const BUGGY_IMPL = [
  'export function listClinics(clinics, { tenantId, state }) {',
  '  return clinics',
  '    .filter((c) => c.state === state && c.status === "active" && c.bookable)',
  '    .map(({ id, name, city, state }) => ({ id, name, city, state }));',
  '}', '',
].join("\n");

const GOOD_IMPL = [
  'export function listClinics(clinics, { tenantId, state }) {',
  '  if (!tenantId) throw new Error("tenant is required");',
  '  return clinics',
  '    .filter((c) => c.tenantId === tenantId && c.state === state && c.status === "active" && c.bookable)',
  '    .map(({ id, name, city, state }) => ({ id, name, city, state }));',
  '}', '',
].join("\n");

const check = (id: string, command: string) => [{ id, description: command, command, expectExit: 0 }];
const task = (id: string, role: string, write: string[], checks: string, extra: object = {}) => ({
  id, title: id, objective: `${id} objective`, role, requirementIds: ["FR-003"], scope: { write },
  requiredChecks: check("verify", checks), budget: { maxRetries: 2, maxMinutes: 2 }, ...extra,
});
const result = (t: Task, status = "completed", summary = "done") => ({
  taskId: t.id, status, summary, changedFiles: [], testsExecuted: [], criteriaSatisfied: [], criteriaUnsatisfied: [], risks: [],
});

describe("harness acceptance test", () => {
  it("plans, implements, fails on an injected defect, diagnoses, repairs, resumes after a crash, and stops at a prohibited action", async () => {
    // ---- a real repo whose base commit holds the owner-approved acceptance tests
    const repo = mkdtempSync(join(tmpdir(), "acc-repo-"));
    git(repo, "init", "-q", "-b", "main");
    put(repo, "package.json", '{"type":"module"}'); put(repo, "test/clinics.test.js", ACCEPTANCE_TESTS); put(repo, "src/clinics.js", 'export function listClinics() { throw new Error("not implemented"); }\n');
    git(repo, "add", "-A"); git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed: acceptance tests for FR-003");

    const stateFile = join(mkdtempSync(join(tmpdir(), "acc-state-")), "tasks.json");
    let crashArmed = true; let live: StateStore | undefined;
    const open = () => StateStore.open(stateFile, { afterSave: () => {
      if (!crashArmed || !live) return;
      try { if (live.task("T-impl").lastFailure) { crashArmed = false; throw new Error("simulated crash after the failure was persisted"); } } catch (e) { if ((e as Error).message.startsWith("simulated")) throw e; }
    } });

    // ---- plan: dependency graph
    live = open();
    live.addTask(task("T-spec", "product", ["docs/requirements/**"], "test -s docs/requirements/FR-003.md"));
    live.addTask(task("T-impl", "backend", ["src/**"], "node --test", { dependsOn: ["T-spec"], highRisk: true }));
    live.addTask(task("T-ship", "sre", ["release/**"], "test -s release/NOTES.md", { dependsOn: ["T-impl"] }));

    // ---- scripted workers (stand-ins for Claude specialists)
    const calls: Record<string, number> = {}; const marker = join(repo, "PUSHED.marker"); const shellLog: string[] = [];
    const makeAgent = (store: () => StateStore): AgentRunner => async (t, cwd) => {
      calls[t.id] = (calls[t.id] ?? 0) + 1;
      if (t.id === "T-spec") put(cwd, "docs/requirements/FR-003.md", "# FR-003\nList only active, bookable clinics for the current tenant and state.\n");
      if (t.id === "T-impl") put(cwd, "src/clinics.js", t.lastFailure ? GOOD_IMPL : BUGGY_IMPL);  // defect injected on the first attempt only
      if (t.id === "T-ship") {
        put(cwd, "release/NOTES.md", "Release notes for FR-003.\n");
        const d = guardCommand(store(), "git push origin main", t.id);
        shellLog.push(`${d.allowed ? "ALLOWED" : "DENIED"}: git push origin main (${d.reason})`);
        if (!d.allowed) return result(t, "blocked", `waiting for approval ${d.approvalId}`);
        writeFileSync(marker, "stand-in for the push; the real push command is never executed here\n");
      }
      return result(t);
    };
    const reviewer: Reviewer = async (t) => {
      const src = readFileSync(join(repo, ".worktrees", t.id, "src/clinics.js"), "utf8");
      const ok = /c\.tenantId === tenantId/.test(src);
      return { taskId: t.id, reviewerRole: "security", verdict: ok ? "pass" : "fail", reasons: ok ? ["tenant filter present"] : ["no tenant isolation"], at: new Date().toISOString() };
    };
    const build = (s: StateStore) => new Orchestrator(s, worktreeWorker({ repo, agent: makeAgent(() => s) }), makeRunnerVerifier({ repo }), { maxConcurrent: 2 }, reviewer, { maxDispatches: 20, maxWallMs: 120_000 });

    // ---- run 1: crashes right after the first real failure is persisted
    await expect(build(live).run()).rejects.toThrow(/simulated crash/);
    const onDisk = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(onDisk.tasks["T-impl"].lastFailure.category).toBe("code_or_test");
    expect(onDisk.tasks["T-impl"].lastFailure.excerpt).toMatch(/leaked clinic c4|BR-001/);      // real failing output
    expect(onDisk.tasks["T-spec"].status).toBe("done");

    // ---- run 2: new process resumes from disk; stops at the prohibited action
    const resumed = open(); live = resumed;
    expect(resumed.task("T-spec").status).toBe("done");
    const out2 = await build(resumed).run();
    expect(calls["T-spec"]).toBe(1);                                  // finished work not redone after the crash
    expect(resumed.task("T-impl").status).toBe("done");               // repaired on retry, verified, reviewed
    expect(out2).toMatchObject({ kind: "stalled", blocked: expect.arrayContaining(["T-ship"]) });
    expect(existsSync(marker)).toBe(false);                           // the prohibited action did NOT happen
    const pending = Object.values(resumed.snapshot().approvals);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ action: "push_remote", status: "requested", taskId: "T-ship" });

    // ---- human grants; the harness continues
    resumed.decideApproval(pending[0]!.id, "granted", "owner");
    resumed.transition("T-ship", "ready");
    const out3 = await build(resumed).run();
    expect(out3.kind).toBe("complete");
    expect(existsSync(marker)).toBe(true);

    // ---- evidence checks on the final state
    const final = resumed.snapshot();
    const implEv = Object.values(final.evidence).filter((e) => e.taskId === "T-impl").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const codes = implEv.map((e) => e.exitCode);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    expect(codes.at(-1)).toBe(0);                                     // ends with a passing run
    expect(codes.slice(0, -1).every((c) => c !== 0)).toBe(true);      // every earlier run is a real failure, kept on record
    // The crash hit after the diagnosis was saved but before the task left needs_review, so the resumed run
    // re-verified the unchanged buggy code (second failing run) rather than trusting or redoing anything.
    expect(implEv[0]!.outputExcerpt).toMatch(/not ok|AssertionError|leaked clinic/);
    expect(final.tasks["T-impl"]!.retries).toBeGreaterThanOrEqual(1);
    expect(final.verdicts["T-impl"]).toMatchObject({ verdict: "pass", reviewerRole: "security" });
    expect(Object.values(final.tasks).every((t) => t.status === "done")).toBe(true);
    expect(shellLog[0]).toMatch(/^DENIED/); expect(shellLog.at(-1)).toMatch(/^ALLOWED/);
    expect(git(repo, "rev-parse", "main")).toBe(git(repo, "rev-list", "--max-parents=0", "main")); // main never moved
    expect(git(repo, "show", "task/T-impl:test/clinics.test.js")).toBe(ACCEPTANCE_TESTS.trimEnd());  // acceptance tests untouched

    if (process.env.ACCEPTANCE_REPORT) {
      const md = renderReport(final, "Harness acceptance run — FR-003 clinic filtering");
      const head = [
        "> Generated by `harness/test/acceptance.test.ts` from the persisted state of an actual run.",
        "> Workers were scripted agents (not live Claude); the repo, git worktrees, scope checks, command runner, evidence, classification, review gate, approval gate, crash and resume are real.", "",
        "## Prohibited-action log", "", ...shellLog.map((l) => `- ${l}`), "",
        `Worker calls: ${JSON.stringify(calls)} (T-impl worker ran twice: defect, then repair; T-spec ran once across the crash. The crash stranded T-impl in needs_review, so the resumed run re-verified it, producing one extra failing evidence record before the repair.)`, "",
      ].join("\n");
      writeFileSync(process.env.ACCEPTANCE_REPORT, md.replace("\n\n", `\n\n${head}\n`));
    }
  }, 60_000);
});

import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { StateStore } from "../src/store.js";
import { Orchestrator } from "../src/orchestrator.js";
import { worktreeWorker, buildWorkerPrompt, type AgentRunner } from "../src/dispatch.js";
import { changedPaths, checkScope, branchFor } from "../src/worktree.js";
import { globToRegExp } from "../src/glob.js";
import type { Evidence, Task } from "../src/schemas.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const check = { id: "unit", description: "u", command: "npm test", expectExit: 0 };
const mk = (id: string, write: string[], extra: object = {}) => ({
  id, title: id, objective: "o", role: "backend", scope: { write }, requiredChecks: [check], ...extra,
});
const ev = (t: Task): Evidence => ({
  id: `E-${t.id}`, taskId: t.id, checkId: "unit", command: "npm test", exitCode: 0,
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  outputSha256: "c".repeat(64), outputExcerpt: "", recordedBy: "runner",
});
const put = (cwd: string, rel: string, body = "x") => { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), body); };
const report = (t: Task, files: string[] = []) => ({
  taskId: t.id, status: "completed", summary: "s", changedFiles: files, testsExecuted: [],
  criteriaSatisfied: [], criteriaUnsatisfied: [], risks: [],
});

let repo: string; let store: StateStore;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "repo-"));
  git(repo, "init", "-q", "-b", "main");
  put(repo, "README.md", "hi"); put(repo, "harness/state/tasks.json", "{}"); put(repo, "apps/api/keep.ts", "k");
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  store = StateStore.open(join(mkdtempSync(join(tmpdir(), "st-")), "tasks.json"));
});

describe("glob", () => {
  it("matches the expected paths", () => {
    expect(globToRegExp("apps/api/**").test("apps/api/src/a.ts")).toBe(true);
    expect(globToRegExp("apps/api/**").test("apps/web/a.ts")).toBe(false);
    expect(globToRegExp("apps/*/x.ts").test("apps/api/x.ts")).toBe(true);
    expect(globToRegExp("apps/*/x.ts").test("apps/api/deep/x.ts")).toBe(false);
    expect(globToRegExp("**/.env").test(".env")).toBe(true);
  });
});

describe("scope enforcement from git", () => {
  it("accepts in-scope work, commits it to the task branch, and leaves main untouched", async () => {
    store.addTask(mk("T-a", ["apps/api/**"]));
    const agent: AgentRunner = async (t, cwd) => { put(cwd, "apps/api/new.ts"); return report(t, ["apps/api/new.ts"]); };
    const out = await new Orchestrator(store, worktreeWorker({ repo, agent }), async (t) => [ev(t)]).run();
    expect(out.kind).toBe("complete");
    expect(git(repo, "show", `${branchFor("T-a")}:apps/api/new.ts`)).toBe("x");
    expect(existsSync(join(repo, "apps/api/new.ts"))).toBe(false);      // main checkout untouched
    expect(git(repo, "rev-parse", "main")).toBe(git(repo, "rev-list", "--max-parents=0", "main"));
  });
  it("rejects a change outside the write scope", async () => {
    store.addTask(mk("T-a", ["apps/api/**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    const agent: AgentRunner = async (t, cwd) => { put(cwd, "apps/web/oops.ts"); return report(t, ["apps/web/oops.ts"]); };
    await new Orchestrator(store, worktreeWorker({ repo, agent }), async (t) => [ev(t)]).run();
    expect(store.task("T-a").status).toBe("escalated");                  // even though a verifier would have passed
    expect(store.snapshot().results["T-a"]!.risks.join()).toMatch(/outside write scope: apps\/web\/oops.ts/);
  });
  it("rejects protected paths even when the scope is **", async () => {
    store.addTask(mk("T-a", ["**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    const agent: AgentRunner = async (t, cwd) => { put(cwd, "harness/state/tasks.json", "{\"hacked\":1}"); return report(t); };
    await new Orchestrator(store, worktreeWorker({ repo, agent }), async (t) => [ev(t)]).run();
    expect(store.task("T-a").status).toBe("escalated");
    expect(store.snapshot().results["T-a"]!.risks.join()).toMatch(/protected path: harness\/state\/tasks.json/);
  });
  it("catches deletions, renames and new .env files, not just edits", async () => {
    store.addTask(mk("T-a", ["apps/api/**"]));
    const wt = (await (async () => { const w = worktreeWorker({ repo, agent: async (t) => report(t) }); await w({ ...store.task("T-a") } as Task); return join(repo, ".worktrees", "T-a"); })());
    renameSync(join(wt, "apps/api/keep.ts"), join(wt, "apps/api/moved.ts"));
    put(wt, "apps/api/.env", "SECRET=1");
    const changed = changedPaths(wt);
    expect(changed).toEqual(expect.arrayContaining(["apps/api/keep.ts", "apps/api/moved.ts", "apps/api/.env"]));
    expect(checkScope(changed, ["apps/api/**"]).protectedHits).toEqual(["apps/api/.env"]);
  });
  it("uses git's list of changes, not the agent's claim, and notes the mismatch", async () => {
    store.addTask(mk("T-a", ["apps/api/**"]));
    const agent: AgentRunner = async (t, cwd) => { put(cwd, "apps/api/real.ts"); return report(t, ["apps/api/imaginary.ts"]); };
    await new Orchestrator(store, worktreeWorker({ repo, agent }), async (t) => [ev(t)]).run();
    const r = store.snapshot().results["T-a"]!;
    expect(r.changedFiles).toEqual(["apps/api/real.ts"]);
    expect(r.risks.join()).toMatch(/differ from git/);
  });
  it("treats malformed agent output as a failed attempt", async () => {
    store.addTask(mk("T-a", ["apps/api/**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    await new Orchestrator(store, worktreeWorker({ repo, agent: async () => ({ nonsense: true }) }), async (t) => [ev(t)]).run();
    expect(store.task("T-a").status).toBe("escalated");
    expect(store.snapshot().results["T-a"]!.summary).toMatch(/invalid result/);
  });
});

describe("isolation and parallelism", () => {
  it("runs two tasks concurrently in separate worktrees without seeing each other's files", async () => {
    store.addTask(mk("T-a", ["apps/api/**"])); store.addTask(mk("T-b", ["apps/web/**"]));
    const seen: Record<string, boolean> = {};
    const agent: AgentRunner = async (t, cwd) => {
      put(cwd, t.id === "T-a" ? "apps/api/a.ts" : "apps/web/b.ts");
      await new Promise((r) => setTimeout(r, 30));
      seen[t.id] = existsSync(join(cwd, t.id === "T-a" ? "apps/web/b.ts" : "apps/api/a.ts"));
      return report(t);
    };
    const out = await new Orchestrator(store, worktreeWorker({ repo, agent }), async (t) => [ev(t)], { maxConcurrent: 2 }).run();
    expect(out.kind).toBe("complete");
    expect(seen).toEqual({ "T-a": false, "T-b": false });
  });
  it("reuses an existing worktree on resume instead of failing", async () => {
    store.addTask(mk("T-a", ["apps/api/**"]));
    const w = worktreeWorker({ repo, agent: async (t) => report(t) });
    await w(store.task("T-a")); await w(store.task("T-a"));
  });
});

describe("worker contract", () => {
  it("states scope, forbidden actions, checks and no-delegation in the prompt", () => {
    store.addTask(mk("T-a", ["apps/api/**"], { requirementIds: ["FR-008"] }));
    const p = buildWorkerPrompt(store.task("T-a"));
    for (const s of ["FR-008", "apps/api/**", "harness/state", "Do not delegate", "Do not edit or delete tests", "unit: npm test"]) expect(p).toContain(s);
  });
});

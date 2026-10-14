import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore, HarnessError } from "../src/store.js";

const check = { id: "unit", description: "unit tests", command: "npm test", expectExit: 0 };
const task = (id: string, extra: object = {}) => ({
  id, title: id, objective: "obj", role: "backend",
  scope: { write: ["apps/api/**"] }, requiredChecks: [check], ...extra,
});
const evidence = (taskId: string, exitCode: number, id = `E-${taskId}-${exitCode}`) => ({
  id, taskId, checkId: "unit", command: "npm test", exitCode,
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  outputSha256: "a".repeat(64), outputExcerpt: "ok", recordedBy: "runner",
});
const result = (taskId: string, status = "completed") => ({
  taskId, status, summary: "did it", changedFiles: [], testsExecuted: [],
  criteriaSatisfied: [], criteriaUnsatisfied: [], risks: [],
});

let file: string;
let s: StateStore;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "harness-")), "tasks.json");
  s = StateStore.open(file);
});

function toReview(id: string) {
  s.transition(id, "ready"); s.transition(id, "in_progress"); s.submitResult(result(id));
}

describe("task graph", () => {
  it("rejects unknown dependencies and cycles", () => {
    expect(() => s.addTask(task("T-a", { dependsOn: ["T-zzz"] }))).toThrow(/unknown task/);
    s.addTask(task("T-a"));
    s.addTask(task("T-b", { dependsOn: ["T-a"] }));
    expect(() => s.addTask(task("T-a", {}))).toThrow(/already exists/);
  });
  it("rejects a task with no required checks", () => {
    expect(() => s.addTask(task("T-a", { requiredChecks: [] }))).toThrow();
  });
  it("blocks a task from becoming ready while a dependency is unfinished", () => {
    s.addTask(task("T-a")); s.addTask(task("T-b", { dependsOn: ["T-a"] }));
    expect(() => s.transition("T-b", "ready")).toThrow(/unfinished dependencies/);
  });
  it("detects a cycle in a corrupted state file on open", () => {
    s.addTask(task("T-a")); s.addTask(task("T-b", { dependsOn: ["T-a"] }));
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.tasks["T-a"].dependsOn = ["T-b"];
    writeFileSync(file, JSON.stringify(raw));
    expect(() => StateStore.open(file)).toThrow(/cycle/);
  });
});

describe("completion is computed from evidence, never claimed", () => {
  it("a worker result saying 'completed' moves to needs_review, not done", () => {
    s.addTask(task("T-a")); toReview("T-a");
    expect(s.task("T-a").status).toBe("needs_review");
  });
  it("done cannot be set through transition()", () => {
    s.addTask(task("T-a")); toReview("T-a");
    expect(() => s.transition("T-a", "done")).toThrow(/markDone/);
  });
  it("markDone fails without evidence and with failing evidence", () => {
    s.addTask(task("T-a")); toReview("T-a");
    expect(() => s.markDone("T-a")).toThrow(/lacks passing evidence/);
    s.recordEvidence(evidence("T-a", 1));
    expect(() => s.markDone("T-a")).toThrow(/lacks passing evidence/);
  });
  it("markDone succeeds with passing runner evidence; a later failing run revokes it", () => {
    s.addTask(task("T-a")); toReview("T-a");
    s.recordEvidence(evidence("T-a", 0));
    s.recordEvidence(evidence("T-a", 1, "E-late-fail"));
    expect(() => s.markDone("T-a")).toThrow(/lacks passing evidence/);
    s.recordEvidence(evidence("T-a", 0, "E-rerun"));
    s.markDone("T-a");
    expect(s.task("T-a").status).toBe("done");
  });
  it("rejects evidence not written by the runner or for an unknown check", () => {
    s.addTask(task("T-a"));
    expect(() => s.recordEvidence({ ...evidence("T-a", 0), recordedBy: "worker" })).toThrow();
    expect(() => s.recordEvidence({ ...evidence("T-a", 0), checkId: "nope" })).toThrow(/not a required check/);
  });
  it("rejects malformed worker results and results for tasks not in progress", () => {
    s.addTask(task("T-a"));
    expect(() => s.submitResult(result("T-a"))).toThrow(/only accepted while in_progress/);
    s.transition("T-a", "ready"); s.transition("T-a", "in_progress");
    expect(() => s.submitResult({ taskId: "T-a", status: "completed" })).toThrow();
  });
  it("unlocks dependents only after the dependency is done", () => {
    s.addTask(task("T-a")); s.addTask(task("T-b", { dependsOn: ["T-a"] }));
    toReview("T-a"); s.recordEvidence(evidence("T-a", 0)); s.markDone("T-a");
    s.transition("T-b", "ready");
    expect(s.task("T-b").status).toBe("ready");
  });
});

describe("bounded retries", () => {
  it("allows maxRetries re-runs then forces escalation", () => {
    s.addTask(task("T-a", { budget: { maxRetries: 1, maxMinutes: 10 } }));
    s.transition("T-a", "ready"); s.transition("T-a", "in_progress"); s.submitResult(result("T-a", "failed"));
    s.transition("T-a", "ready"); // retry 1
    s.transition("T-a", "in_progress"); s.submitResult(result("T-a", "failed"));
    expect(() => s.transition("T-a", "ready")).toThrow(/exhausted its retry budget/);
    s.transition("T-a", "escalated");
    expect(s.task("T-a").status).toBe("escalated");
  });
});

describe("approvals fail closed", () => {
  it("denies restricted actions until a human grants them", () => {
    expect(s.isAllowed("push_remote")).toBe(false);
    const a = s.requestApproval("push_remote", "push main to origin");
    expect(s.isAllowed("push_remote")).toBe(false);
    s.decideApproval(a.id, "denied", "suresh");
    expect(s.isAllowed("push_remote")).toBe(false);
    const b = s.requestApproval("push_remote", "push branch");
    s.decideApproval(b.id, "granted", "suresh");
    expect(s.isAllowed("push_remote")).toBe(true);
    expect(s.isAllowed("production_deploy")).toBe(false);
  });
});

describe("durability", () => {
  it("resumes from disk with identical state and leaves no temp file", () => {
    s.addTask(task("T-a")); toReview("T-a");
    const before = s.snapshot();
    const reopened = StateStore.open(file);
    expect(reopened.snapshot()).toEqual(before);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
  it("refuses to load a corrupt file instead of guessing", () => {
    writeFileSync(file, "{ not json");
    expect(() => StateStore.open(file)).toThrow();
    writeFileSync(file, JSON.stringify({ version: 2 }));
    expect(() => StateStore.open(file)).toThrow(HarnessError);
  });
});

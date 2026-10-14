import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installWorkerPolicy, workerSettings } from "../src/workerpolicy.js";
import { changedPaths } from "../src/worktree.js";
import { Task } from "../src/schemas.js";

const task = Task.parse({
  id: "T-x", title: "x", objective: "x", role: "backend", requirementIds: [], scope: { write: ["src/a.ts"] },
  requiredChecks: [{ id: "t", description: "t", command: "npx vitest run src/a.test.ts" }], budget: { maxRetries: 1, maxMinutes: 5 },
  status: "ready", retries: 0, evidenceIds: [], updatedAt: new Date().toISOString(), dependsOn: [], highRisk: false,
});

describe("worker policy", () => {
  it("allows writes only inside the task scope and only the task's own check commands", () => {
    const s = workerSettings(task, "node hook.mjs");
    expect(s.permissions.allow).toContain("Edit(src/a.ts)");
    expect(s.permissions.allow).toContain("Bash(npx vitest:*)");
    expect(s.permissions.allow.some((r) => /^Bash\(\*|^Bash$/.test(r))).toBe(false);
    expect(s.permissions.deny).toEqual(expect.arrayContaining(["Agent", "Read(.env)"]));
    expect(s.hooks.PreToolUse[0]!.hooks[0]!.command).toBe("node hook.mjs");
  });
  it("installs the settings file without it appearing as a change in git", () => {
    const repo = mkdtempSync(join(tmpdir(), "wp-"));
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
    g("init", "-q", "-b", "main"); writeFileSync(join(repo, "f"), "1"); g("add", "-A"); g("commit", "-qm", "i");
    const file = installWorkerPolicy(repo, repo, task, "/h/pretooluse.mjs");
    expect(JSON.parse(readFileSync(file, "utf8")).permissions.allow).toContain("Write(src/a.ts)");
    expect(changedPaths(repo)).toEqual([]);
  });
});

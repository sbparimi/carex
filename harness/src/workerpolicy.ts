import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Task } from "./schemas.js";

/** Permission rules for one worker, derived from its task contract: write only inside scope, run only its own checks. */
export function workerSettings(task: Task, hookCommand: string) {
  const prefix = (cmd: string) => cmd.trim().split(/\s+/).slice(0, 2).join(" ");
  const allow = [
    "Read", "Glob", "Grep",
    ...task.scope.write.flatMap((g) => [`Edit(${g})`, `Write(${g})`]),
    ...[...new Set(task.requiredChecks.map((c) => prefix(c.command)))].map((p) => `Bash(${p}:*)`),
  ];
  const deny = ["Agent", "WebFetch", "WebSearch", "Read(.env)", "Read(.env.*)", "Read(**/.env)", "Read(**/.env.*)"];
  return { permissions: { allow, deny }, hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }] } };
}

/**
 * Writes the worker's settings into its worktree as `.claude/settings.local.json` and excludes that file from git,
 * so it never shows up as a worker change. Works in environments where the CLI accepts no permission flags.
 */
export function installWorkerPolicy(repo: string, cwd: string, task: Task, hookPath = join(resolve(repo), "harness/hooks/pretooluse.mjs")): string {
  const dir = join(cwd, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "settings.local.json");
  writeFileSync(file, JSON.stringify(workerSettings(task, `node ${hookPath}`), null, 2));
  const rel = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd, encoding: "utf8" }).trim();
  const exclude = isAbsolute(rel) ? rel : join(cwd, rel);
  mkdirSync(join(exclude, ".."), { recursive: true });
  const cur = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (!cur.includes(".claude/settings.local.json")) appendFileSync(exclude, `${cur.endsWith("\n") || !cur ? "" : "\n"}.claude/settings.local.json\n`);
  return file;
}

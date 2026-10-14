import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { matchesAny } from "./glob.js";

/** Paths no worker may ever change, whatever its task scope says. */
export const PROTECTED_PATHS = [
  "harness/state/**", ".git/**", ".github/workflows/**", "docs/prd/**", ".env", ".env.*", "**/.env", "**/.env.*",
];

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export const branchFor = (taskId: string) => `task/${taskId}`;
export const worktreePath = (repo: string, taskId: string) => join(repo, ".worktrees", taskId);

/** Fresh isolated checkout for one task, branched from baseRef. Idempotent for resume: reuses an existing one. */
export function createWorktree(repo: string, taskId: string, baseRef = "HEAD"): string {
  const dir = worktreePath(repo, taskId);
  const existing = git(repo, ["worktree", "list", "--porcelain"]).includes(`worktree ${dir}`);
  if (!existing) git(repo, ["worktree", "add", "-b", branchFor(taskId), dir, baseRef]);
  return dir;
}

/** Every path a worker touched, from git itself (never from the worker's own report). */
export function changedPaths(cwd: string): string[] {
  const out = git(cwd, ["status", "--porcelain=v1", "-z", "-uall"]);
  const parts = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (/[RC]/.test(xy)) paths.push(parts[++i]!); // rename/copy lists the origin as a separate field
  }
  return [...new Set(paths)].sort();
}

export interface ScopeCheck { ok: boolean; outOfScope: string[]; protectedHits: string[] }

export function checkScope(changed: string[], writeGlobs: string[]): ScopeCheck {
  const protectedHits = changed.filter((p) => matchesAny(p, PROTECTED_PATHS));
  const outOfScope = changed.filter((p) => !matchesAny(p, writeGlobs) && !protectedHits.includes(p));
  return { ok: protectedHits.length === 0 && outOfScope.length === 0, outOfScope, protectedHits };
}

export function commitAll(cwd: string, message: string): string | null {
  git(cwd, ["add", "-A"]);
  if (!git(cwd, ["status", "--porcelain"]).trim()) return null;
  git(cwd, ["-c", "user.name=carex-harness", "-c", "user.email=harness@localhost", "commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]).trim();
}

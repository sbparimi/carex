import { execFileSync } from "node:child_process";

const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const DISABLERS = /\b(it|test|describe)\.(skip|only|todo|fixme)\b|\b(xit|xdescribe|xtest)\(|\.skip\(|\.only\(|@pytest\.mark\.skip/;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const ASSERT = /\b(expect|assert)\w*\s*[(.]/g;

const git = (cwd: string, args: string[]) => {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch { return null; }
};

export interface Tamper { file: string; reason: string }

/**
 * Compares the worktree (committed + uncommitted) to the base ref. Adding tests is fine.
 * Flags: deleted test files, newly skipped/focused tests, and test files whose assertion count dropped.
 */
export function detectTampering(cwd: string, baseRef: string): Tamper[] {
  const found: Tamper[] = [];
  const names = git(cwd, ["diff", "--name-status", baseRef]);
  if (names === null) return [{ file: "(repo)", reason: `cannot diff against ${baseRef}` }];
  for (const line of names.split("\n").filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    const file = rest[rest.length - 1]!;
    const oldFile = rest[0]!;
    if (!TEST_FILE.test(oldFile) && !TEST_FILE.test(file)) continue;
    if (status!.startsWith("D")) { found.push({ file: oldFile, reason: "test file deleted" }); continue; }
    const before = git(cwd, ["show", `${baseRef}:${oldFile}`]) ?? "";
    const diff = git(cwd, ["diff", baseRef, "--", file]) ?? "";
    const nowText = (() => { try { return execFileSync("cat", [file], { cwd, encoding: "utf8" }); } catch { return ""; } })();
    const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    if (DISABLERS.test(addedLines)) found.push({ file, reason: "test disabled or focused (skip/only/todo)" });
    if (before && count(nowText, ASSERT) < count(before, ASSERT)) found.push({ file, reason: "assertion count decreased" });
  }
  return found;
}

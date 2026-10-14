#!/usr/bin/env node
// Claude Code PreToolUse hook. Blocks restricted shell commands and sensitive file access for workers.
// Exit code 2 = block; stderr is shown to the agent. Fails closed on any parse error for Bash.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkCommand } from "../src/policy.mjs";

const PROTECTED = [/(^|\/)harness\/state\//, /(^|\/)docs\/prd\//, /(^|\/)\.env(\.|$)/, /(^|\/)\.git\//, /(^|\/)\.github\/workflows\//];
const stateFile = process.env.HARNESS_STATE ?? "harness/state/tasks.json";
const requests = process.env.HARNESS_APPROVAL_REQUESTS ?? resolve(dirname(stateFile), "approval-requests.jsonl");
const taskId = process.env.HARNESS_TASK_ID;

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); }
catch { console.error("harness hook: unreadable input; blocking"); process.exit(2); }

const tool = input.tool_name;
const ti = input.tool_input ?? {};

const granted = (action) => {
  try {
    const s = JSON.parse(readFileSync(stateFile, "utf8"));
    return Object.values(s.approvals ?? {}).some((a) => a.action === action && a.status === "granted" && (!a.taskId || a.taskId === taskId));
  } catch { return false; }
};
const deny = (action, reason, command) => {
  try { mkdirSync(dirname(requests), { recursive: true }); appendFileSync(requests, JSON.stringify({ action, reason, command, taskId }) + "\n"); } catch {}
  console.error(`harness: blocked (${reason}). Approval for "${action}" has been requested; do not retry or work around it.`);
  process.exit(2);
};

if (tool === "Bash") {
  const command = String(ti.command ?? "");
  const v = checkCommand(command);
  if (v.restricted && !granted(v.restricted)) deny(v.restricted, v.reason, command);
}
if (["Write", "Edit", "NotebookEdit", "MultiEdit"].includes(tool)) {
  const p = String(ti.file_path ?? ti.notebook_path ?? "");
  if (PROTECTED.some((re) => re.test(p))) deny("modify_acceptance_criteria", `write to protected path ${p}`, p);
}
if (tool === "Read") {
  const p = String(ti.file_path ?? "");
  if (/(^|\/)\.env(\.|$)|\.ssh\/|\.aws\/credentials/.test(p) && !granted("credential_access")) deny("credential_access", `read of ${p}`, p);
}
process.exit(0);

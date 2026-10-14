import type { State } from "./schemas.js";

/** Evidence-based report generated only from recorded state: no model prose, no claims without a record. */
export function renderReport(state: State, title = "Harness run report"): string {
  const tasks = Object.values(state.tasks).sort((a, b) => a.id.localeCompare(b.id));
  const by = (s: string) => tasks.filter((t) => t.status === s).length;
  const L: string[] = [`# ${title}`, ""];
  L.push(`Tasks: ${tasks.length} total, ${by("done")} done, ${by("escalated")} escalated, ${by("blocked")} blocked, ${by("failed")} failed, ${by("pending")} pending, ${by("ready")} ready, ${by("in_progress")} in progress, ${by("needs_review")} awaiting review.`, "");
  L.push("## Tasks", "", "| Task | Role | Status | Retries | Evidence (check: exit, sha256 prefix) |", "|---|---|---|---|---|");
  for (const t of tasks) {
    const ev = t.evidenceIds.map((id) => state.evidence[id]!).map((e) => `${e.checkId}: ${e.exitCode}, ${e.outputSha256.slice(0, 10)}`).join("; ") || "none";
    L.push(`| ${t.id} | ${t.role}${t.highRisk ? " (high-risk)" : ""} | ${t.status} | ${t.retries}/${t.budget.maxRetries} | ${ev} |`);
  }
  const attempts = Object.values(state.evidence).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const failures = attempts.filter((e) => { const c = state.tasks[e.taskId]?.requiredChecks.find((x) => x.id === e.checkId); return c && e.exitCode !== c.expectExit; });
  L.push("", "## Failed verifications (actual output)", "");
  if (!failures.length) L.push("None recorded.");
  for (const e of failures) L.push(`- **${e.taskId}** check \`${e.checkId}\` exit ${e.exitCode} (\`${e.command}\`)`, "  ```", ...e.outputExcerpt.split("\n").slice(-12).map((l) => `  ${l}`), "  ```");
  const diag = tasks.filter((t) => t.lastFailure);
  L.push("", "## Diagnoses", "");
  if (!diag.length) L.push("None recorded.");
  for (const t of diag) L.push(`- **${t.id}**: ${t.lastFailure!.category}. ${t.lastFailure!.summary}`);
  const ap = Object.values(state.approvals);
  L.push("", "## Approvals", "");
  if (!ap.length) L.push("None requested.");
  for (const a of ap) L.push(`- ${a.id} \`${a.action}\` — ${a.status}${a.decidedBy ? ` by ${a.decidedBy}` : ""}: ${a.description}`);
  const vs = Object.values(state.verdicts);
  if (vs.length) { L.push("", "## Independent reviews", ""); for (const v of vs) L.push(`- ${v.taskId}: ${v.verdict} by ${v.reviewerRole}`); }
  L.push("", "## Log", "", ...state.log.map((l) => `- ${l.at} ${l.event}${l.taskId ? ` ${l.taskId}` : ""}${l.detail ? ` (${l.detail})` : ""}`));
  return L.join("\n") + "\n";
}

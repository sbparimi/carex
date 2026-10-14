import type { Diagnosis, Evidence, FailureCategory } from "./schemas.js";

/** Heuristic classification of a failed check from its real output. Order matters: most specific first. */
export function classifyFailure(ev: Pick<Evidence, "exitCode" | "outputExcerpt" | "command">): FailureCategory {
  const out = ev.outputExcerpt;
  if (ev.command === "harness tamper-check") return "policy";
  if (ev.exitCode === 124) return "timeout";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|getaddrinfo/i.test(out)) return "infrastructure";
  if (/\b(429|502|503|504)\b.*(error|status)|rate limit|service unavailable/i.test(out)) return "external_dependency";
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|command not found|ENOENT|Missing script|No test files found|not recognized/i.test(out)) return "configuration";
  if (/AssertionError|expected .* (to|but)|\bFAIL\b|✗|×|not ok \d+|Tests? +\d* ?failed|TypeError|ReferenceError|SyntaxError/i.test(out)) return "code_or_test";
  return "unknown";
}

/** Only these can be fixed by changing the work product; the rest need a human or an environment fix. */
export const RETRYABLE = new Set<FailureCategory>(["code_or_test", "configuration", "timeout", "unknown"]);

export function diagnose(ev: Evidence): Diagnosis {
  const category = classifyFailure(ev);
  const hint: Record<FailureCategory, string> = {
    code_or_test: "A check failed with an assertion or runtime error. Decide whether the code or the test's assumption is wrong; fix the code unless the requirement itself shows the test is wrong. Never weaken or delete the test.",
    configuration: "The check could not run as configured (missing module, script or file). Fix configuration inside your scope.",
    infrastructure: "Network or environment failure. Not fixable by changing code; escalate.",
    external_dependency: "An external service failed. Not fixable by changing code; escalate.",
    timeout: "The check timed out. Look for hangs or unbounded work.",
    policy: "The change violated harness policy (test tampering). Restore the removed or disabled tests.",
    unknown: "Cause unclear. Reproduce with the command given and read the full output.",
  };
  return { category, summary: hint[category], evidenceId: ev.id, reproduce: ev.command, excerpt: ev.outputExcerpt.slice(-2000) };
}

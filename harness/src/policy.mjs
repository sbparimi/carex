// Plain ESM so both the TypeScript harness and the Claude Code hook script can import it with no build step.

/** [action, pattern, reason] — evaluated against each shell command. Fail closed: a match is restricted. */
const RULES = [
  ["push_remote", /\bgit\s+(?:-\S+\s+)*push\b/, "git push"],
  ["merge_to_main", /\bgit\s+(?:-\S+\s+)*(?:merge|rebase)\b[^;&|\n]*\b(?:main|master)\b/, "merge/rebase into main"],
  ["merge_to_main", /\bgh\s+pr\s+merge\b/, "gh pr merge"],
  ["production_deploy", /\b(?:vercel|netlify|firebase|fly|flyctl|heroku)\b[^;&|\n]*(?:--prod|deploy|release)\b/, "production deploy"],
  ["production_deploy", /\b(?:kubectl\s+(?:apply|rollout)|terraform\s+apply|npm\s+publish|pnpm\s+publish|docker\s+push|gh\s+release\s+create)\b/, "deploy or publish"],
  ["destructive_infra", /\b(?:terraform\s+destroy|kubectl\s+delete|mkfs|dd\s+if=)\b|\bdrop\s+(?:table|database)\b/i, "destructive infrastructure"],
  ["destructive_infra", /\brm\s+-[a-z]*[rf][a-z]*\s+(?:\/|~|\$HOME|\*|\.\.?)(?:\s|$)/, "recursive delete of a broad path"],
  ["destructive_infra", /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|--force(?:-with-lease)?\b/, "destructive git operation"],
  ["destructive_infra", /\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/, "pipe remote script into a shell"],
  ["credential_access", /\.env(?:\.\w+)?\b|\.ssh\/|\.aws\/|\.npmrc\b|\.netrc\b|\bid_(?:rsa|ed25519)\b|\bprintenv\b|(?:^|[;&|]\s*)env\s*(?:$|[;&|])|\$\{?\w*(?:TOKEN|SECRET|PASSWORD|API_?KEY)\w*/i, "reads credentials or secrets"],
  ["authentication", /\b(?:gh\s+auth|npm\s+(?:login|adduser)|aws\s+configure|gcloud\s+auth|az\s+login|docker\s+login|vercel\s+login|ssh-keygen)\b/, "authentication"],
  ["account_connection", /\bclaude\s+mcp\s+add\b|\bgh\s+(?:repo\s+create|api\s+-X\s+(?:POST|PUT|PATCH|DELETE))\b/, "connects or changes an external account"],
];

/** @param {string} command */
export function checkCommand(command) {
  for (const [action, re, reason] of RULES) if (re.test(command)) return { restricted: action, reason };
  return { restricted: null, reason: "" };
}

import { z } from "zod";

export const Role = z.enum([
  "product", "ux", "architect", "frontend", "backend", "ai",
  "security", "qa", "sre", "reviewer", "integration",
]);

export const TaskStatus = z.enum([
  "pending", "ready", "in_progress", "needs_review",
  "blocked", "failed", "escalated", "done",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A verification the runner must execute; only its evidence can make a task done. */
export const Check = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
  expectExit: z.number().int().default(0),
});

export const FailureCategory = z.enum([
  "code_or_test", "configuration", "infrastructure", "external_dependency", "timeout", "policy", "unknown",
]);
export type FailureCategory = z.infer<typeof FailureCategory>;

/** Diagnosis attached to a task after a failed verification; fed to the next attempt. */
export const Diagnosis = z.object({
  category: FailureCategory,
  summary: z.string(),
  evidenceId: z.string(),
  reproduce: z.string(),
  excerpt: z.string().max(2000),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

export const Task = z.object({
  id: z.string().regex(/^T-[A-Za-z0-9_-]+$/),
  title: z.string().min(1),
  objective: z.string().min(1),
  role: Role,
  requirementIds: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  scope: z.object({
    write: z.array(z.string()).default([]),
    read: z.array(z.string()).default([]),
  }),
  requiredChecks: z.array(Check).min(1, "a task needs at least one required check"),
  budget: z.object({
    maxRetries: z.number().int().min(0).default(2),
    maxMinutes: z.number().int().positive().default(30),
  }).default({ maxRetries: 2, maxMinutes: 30 }),
  highRisk: z.boolean().default(false),
  status: TaskStatus.default("pending"),
  retries: z.number().int().min(0).default(0),
  evidenceIds: z.array(z.string()).default([]),
  lastFailure: Diagnosis.optional(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof Task>;

/** Written only by the harness runner. Workers cannot create these. */
export const Evidence = z.object({
  id: z.string().min(1),
  taskId: z.string(),
  checkId: z.string(),
  command: z.string(),
  exitCode: z.number().int(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  outputExcerpt: z.string().max(4000),
  recordedBy: z.literal("runner"),
});
export type Evidence = z.infer<typeof Evidence>;

/** What a worker returns. Advisory only: it never marks a task done. */
export const WorkerResult = z.object({
  taskId: z.string(),
  status: z.enum(["completed", "blocked", "failed", "needs_review"]),
  summary: z.string().min(1),
  changedFiles: z.array(z.string()),
  testsExecuted: z.array(z.object({ command: z.string(), result: z.string() })),
  criteriaSatisfied: z.array(z.string()),
  criteriaUnsatisfied: z.array(z.string()),
  risks: z.array(z.string()),
  nextTask: z.string().optional(),
});
export type WorkerResult = z.infer<typeof WorkerResult>;

/** Independent review. The reviewer must not hold the same role as the task's author. */
export const Verdict = z.object({
  taskId: z.string(),
  reviewerRole: Role,
  verdict: z.enum(["pass", "fail"]),
  reasons: z.array(z.string()),
  at: z.string().datetime(),
});
export type Verdict = z.infer<typeof Verdict>;

export const RestrictedAction = z.enum([
  "production_deploy", "merge_to_main", "push_remote", "authentication",
  "account_connection", "destructive_infra", "credential_access",
  "real_phi_access", "modify_acceptance_criteria",
]);
export type RestrictedAction = z.infer<typeof RestrictedAction>;

export const Approval = z.object({
  id: z.string().min(1),
  action: RestrictedAction,
  description: z.string().min(1),
  taskId: z.string().optional(),
  status: z.enum(["requested", "granted", "denied"]),
  requestedAt: z.string().datetime(),
  decidedBy: z.string().optional(),
  decidedAt: z.string().datetime().optional(),
});
export type Approval = z.infer<typeof Approval>;

export const LogEntry = z.object({
  at: z.string().datetime(),
  event: z.string(),
  taskId: z.string().optional(),
  detail: z.string().optional(),
});

export const State = z.object({
  version: z.literal(1),
  tasks: z.record(Task),
  evidence: z.record(Evidence),
  results: z.record(WorkerResult),
  approvals: z.record(Approval),
  verdicts: z.record(Verdict).default({}),
  log: z.array(LogEntry),
});
export type State = z.infer<typeof State>;

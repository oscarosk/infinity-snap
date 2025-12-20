// backend/src/types.ts

export type RunStatus =
  | "created"
  | "running"
  | "finished"
  | "failed"
  | "generated"
  | "applied"
  | "verified";

export interface RunStepEntry {
  type: string;
  message: string;
  ts: number; // Date.now()
  meta?: Record<string, any>;
}

/**
 * Phase 7 — Timeline event
 * This matches what backend/src/timeline.ts is already producing:
 * - uses `step` and `message`
 * - uses status "start" in at least one event
 */
export type TimelineEvent = {
  /** time offset from run start (timeline.ts decides units) */
  t: number;

  /** step key like "sandbox.run", "analysis.complete", "verify.passed" */
  step: string;

  /** optional human message (often printed into timeline.txt) */
  message?: string;

  /** status markers used by timeline.ts */
  status?: "start" | "ok" | "fail" | "skip";

  /** optional duration for the step */
  durationMs?: number;

  /** optional extra fields */
  meta?: Record<string, any>;
};

export interface RunLogPaths {
  [key: string]: string;
}

export interface RunMetrics {
  runId: string;
  totalMs?: number;
  sandboxMs?: number;
  analysisMs?: number;
  verifyMs?: number;
  lastVerifyAt?: string;
  ts?: string;
  [k: string]: any;
}

export interface AnalysisSummary {
  summary?: string;
  [k: string]: any;
}

export interface PatchFile {
  path: string; // repo-relative path ONLY
  before?: string;
  after: string;
}

export interface PatchSuggestion {
  id?: string;
  confidence?: number;
  notes?: string;
  files: PatchFile[];
  [k: string]: any;
}

export interface RunRecord {
  runId: string;
  repoPath: string;
  command: string;
  status: RunStatus;

  createdAt: string;
  finishedAt: string | null;
  lastUpdatedAt: string;

  steps: RunStepEntry[];

  // outputs
  runResult?: any;
  analysis?: any;

  // patch
  patchPath: string | null;
  suggestions?: PatchSuggestion[];
  suggestion?: { available: boolean; path?: string; generatedAt?: string };

  // apply / verify
  applied?: { appliedAt: string; files: string[] };
  verify?: { verifiedAt: string; result: any };

  // logs
  logPaths: RunLogPaths;

  // artifacts + extras
  artifactsDir: string;
  diffPath: string | null;
  metricsPath: string;

  confidence?: { score: number | null; reasons: string[] };

  // kestra
  kestraExecution?: { id: string; startedAt: string; raw?: any };
  verifications?: Record<
    string,
    Record<string, { ok: boolean; logs: string; ts: string }>
  >;
  aggregate?: any;

  [k: string]: any;
}

export interface RunListItem {
  id: string;
  file: string;
  ts: number;
}

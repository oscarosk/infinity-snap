// cli/src/types.ts

export type OutputFormat = "text" | "json";

export type RunResult = {
  code?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
};

export type Analysis = {
  summary?: string;
  errorDetected?: boolean;
  stackDetected?: boolean;
  languageGuess?: string;
  confidence?: number; // 0..100
};

export type SnapResponse = {
  ok: boolean;
  runId: string;
  runResult?: RunResult;
  analysis?: Analysis;
  error?: string;
};

export type GenerateResponse = {
  ok: boolean;
  available?: boolean;
  suggestion?: any;
  patchPath?: string;
  diffPath?: string | null;
  confidence?: any;
  error?: string;
};

export type ApplyResponse = {
  ok: boolean;
  willApply?: string[];
  applied?: string[];
  error?: string;
};

export type VerifyResponse = {
  ok: boolean;
  verify?: RunResult;
  error?: string;
};

export type ResultsResponse = {
  ok: boolean;
  results?: Array<{ id: string; ts?: number; file: string }>;
  error?: string;
};

export type RunFileResponse = {
  ok: boolean;
  data?: any;
  error?: string;
};

// ------------------------------
// Phase 2/3/4: backend fix pipeline types
// ------------------------------

export type ConfidenceGate = {
  score?: number | null;
  ok?: boolean;
  threshold?: number;
  reasons?: string[];
  signals?: Record<string, any>;
};

export type FixStatus =
  | "verified"
  | "failed"
  | "rolled_back"
  | "confidence_blocked"
  | "refused_low_confidence"
  | "refused_policy"
  | "refused"
  | string;

export type FixResponse = {
  ok?: boolean;
  runId?: string;
  status?: FixStatus;

  // Common optional fields you’ve been returning/logging
  confidence?: ConfidenceGate | null;
  reason?: string | null;
  policy?: any;

  // Some backends return these as nested objects
  verify?: RunResult;
  rollback?: {
    applied?: boolean;
    at?: string;
    reason?: string;
  } | null;

  // Catch-all for any extra backend fields
  [k: string]: any;
};

// ------------------------------
// Phase 6: stable JSON output schema from `runStart`
// ------------------------------

export type RunStartSummary = {
  tool: "infinitysnap";
  mode: "snap" | "fix";
  repoPath: string;
  command: string | null;
  runId: string | null;

  status: string;

  analysis?: Analysis | any;

  confidence?: ConfidenceGate | any;
  fix?: FixResponse | any;
  verify?: RunResult | any;

  rollback?: any;
  refusal?: any;
  fallback?: any;

  timelineTail?: string | null;

  artifacts: {
    endpoints: {
      timelineTxt: string | null; // e.g. /runs/:id/timeline
      runJson: string | null;     // e.g. /runs/:id
    };
    local: {
      reportJson: string;  // .infinitysnap/report.json
      timelineTxt: string; // .infinitysnap/timeline.txt
    };
  };

  error?: any;
};

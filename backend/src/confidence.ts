// backend/src/confidence.ts
import type { PatchSuggestion } from "./types";

/**
 * Signals used to compute a deterministic, judge-auditable confidence score.
 * All values are in [0..1] except reproduction which is boolean.
 */
export type ConfidenceSignals = {
  reproduction?: boolean; // did we reproduce the failure / have clear error?
  coverage?: number;      // how much context / evidence we have
  certainty?: number;     // how certain the analysis is
};

type ResolvedSignals = {
  reproduction: boolean;
  coverage: number;
  certainty: number;
};

type AnalysisLike =
  | {
      summary?: string;
      confidenceSignals?: ConfidenceSignals;
    }
  | null
  | undefined;

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Confidence = weighted combination of signals.
 * This is intentionally transparent and stable for judge demos.
 */
export function computeConfidence(
  suggestions: PatchSuggestion[] | null,
  analysis?: AnalysisLike
) {
  // Defaults are conservative (and *resolved* so TS knows these are numbers)
  const sig: ResolvedSignals = {
    reproduction: analysis?.confidenceSignals?.reproduction ?? true,
    coverage: clamp01(Number(analysis?.confidenceSignals?.coverage ?? 0.65)),
    certainty: clamp01(Number(analysis?.confidenceSignals?.certainty ?? 0.65)),
  };

  // Optional model-provided confidence (if present)
  const modelScoreRaw =
    suggestions && suggestions.length
      ? Number((suggestions[0] as any).confidence ?? NaN)
      : NaN;

  const hasModelScore = Number.isFinite(modelScoreRaw);
  const modelScore = hasModelScore ? clamp01(modelScoreRaw) : null;

  // Weighted blend:
  // - signals dominate (more judge-auditable)
  // - modelScore can help, but can’t override weak signals
  const base =
    (sig.reproduction ? 0.20 : 0.0) +
    0.40 * sig.coverage +
    0.40 * sig.certainty; // base in [0..1]

  const score =
    modelScore === null
      ? clamp01(base)
      : clamp01(0.75 * base + 0.25 * modelScore);

  const reasons: string[] = [];

  // Reasons are *judge-readable*
  reasons.push(`signals.reproduction=${sig.reproduction ? "true" : "false"}`);
  reasons.push(`signals.coverage=${sig.coverage.toFixed(2)}`);
  reasons.push(`signals.certainty=${sig.certainty.toFixed(2)}`);

  if (analysis?.summary) reasons.push("analyzer.summary_present=true");
  if (suggestions?.length) reasons.push("patch_candidates_present=true");
  if (modelScore !== null)
    reasons.push(`model_confidence_used=${modelScore.toFixed(2)}`);

  return {
    score,
    reasons,
    signals: sig, // still returned (now guaranteed numbers)
  };
}

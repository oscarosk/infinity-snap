"use client";

import React from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normalizeConfidence(value: number) {
  // Accept either 0..1 or 0..100
  const v = Number(value);
  if (!Number.isFinite(v)) return null;

  const pct = v <= 1 ? v * 100 : v;
  return clamp(pct, 0, 100);
}

export type ConfidenceBadgeProps = {
  confidence: number | null | undefined;
  label?: string;
  compact?: boolean;
};

export function ConfidenceBadge({
  confidence,
  label = "Confidence",
  compact = false,
}: ConfidenceBadgeProps) {
  if (confidence == null) return null;

  const pct = normalizeConfidence(confidence);
  if (pct == null) return null;

  // ✅ Light pill + dark text (always readable)
  const tone =
    pct >= 80
      ? {
          pill: "border-emerald-300/70 bg-emerald-200 text-slate-950",
          bar: "bg-emerald-600/70",
          dot: "bg-emerald-700",
          label: "High",
        }
      : pct >= 50
      ? {
          pill: "border-amber-300/70 bg-amber-200 text-slate-950",
          bar: "bg-amber-600/70",
          dot: "bg-amber-700",
          label: "Medium",
        }
      : {
          pill: "border-rose-300/70 bg-rose-200 text-slate-950",
          bar: "bg-rose-600/70",
          dot: "bg-rose-700",
          label: "Low",
        };

  const rounded = Math.round(pct);
  const text = compact ? `${rounded}%` : `${label} ${rounded}%`;

  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        "backdrop-blur ring-1 ring-white/10",
        tone.pill
      )}
      title={`${label}: ${pct.toFixed(1)}% (${tone.label})`}
      aria-label={`${label}: ${pct.toFixed(1)} percent (${tone.label})`}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", tone.dot)} />

      <span className="whitespace-nowrap">{text}</span>

      {!compact ? (
        <span className="ml-1 inline-flex items-center">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-black/10">
            <span className={cx("block h-full", tone.bar)} style={{ width: `${pct}%` }} />
          </span>
        </span>
      ) : null}
    </span>
  );
}

export default ConfidenceBadge;

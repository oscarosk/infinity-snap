"use client";

import React from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Tone = "success" | "danger" | "warn" | "neutral" | "refused";
type Variant = "glass" | "flat";

function classifyStatus(raw?: string | null): {
  label: string;
  tone: Tone;
  title: string;
} {
  const s = String(raw || "unknown").toLowerCase();

  if (s.startsWith("refused_")) {
    if (s === "refused_low_confidence") {
      return {
        label: "Refused",
        tone: "refused",
        title: "Autonomy refused: confidence gate blocked applying a fix.",
      };
    }
    if (s === "refused_not_git") {
      return {
        label: "Refused",
        tone: "refused",
        title: "Autonomy refused: repo is not a git repository (.git missing).",
      };
    }
    return { label: "Refused", tone: "refused", title: `Autonomy refused (${s}).` };
  }

  if (["success", "passed", "pass", "fixed", "ok", "verified"].includes(s)) {
    return { label: "Verified", tone: "success", title: "Verification passed after applying the patch." };
  }

  if (["fail", "failed", "error", "broken"].includes(s)) {
    return { label: "Failed", tone: "danger", title: "Run failed (verification or execution did not succeed)." };
  }

  if (["skipped", "skip"].includes(s)) {
    return { label: "Skipped", tone: "neutral", title: "Run was skipped." };
  }

  if (["running", "pending", "queued", "analyzing", "patching", "verifying", "executing", "starting"].includes(s)) {
    return { label: "Running", tone: "warn", title: "Run is in progress." };
  }

  return { label: raw ? String(raw) : "Unknown", tone: "neutral", title: "Unrecognized status." };
}

export type StatusBadgeProps = {
  status?: string | null;
  variant?: Variant;
  prefix?: string;
};

export function StatusBadge({ status, variant = "glass", prefix }: StatusBadgeProps) {
  const meta = classifyStatus(status);
  const label = prefix ? `${prefix} ${meta.label}` : meta.label;

  // ✅ Light chips + DARK text (readable even on glass)
  const toneStyles: Record<Tone, { pill: string; dot: string }> = {
    success: {
      pill: cx("border-emerald-300/70 bg-emerald-200 text-slate-950"),
      dot: "bg-emerald-700",
    },
    danger: {
      pill: cx("border-rose-300/70 bg-rose-200 text-slate-950"),
      dot: "bg-rose-700",
    },
    warn: {
      pill: cx("border-amber-300/70 bg-amber-200 text-slate-950"),
      dot: "bg-amber-700",
    },
    refused: {
      pill: cx("border-violet-300/70 bg-violet-200 text-slate-950"),
      dot: "bg-violet-700",
    },
    neutral: {
      pill: "border-slate-300/70 bg-slate-200 text-slate-950",
      dot: "bg-slate-700",
    },
  };

  const styles = toneStyles[meta.tone];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        "ring-1 ring-white/10",
        variant === "glass" ? "backdrop-blur" : "",
        styles.pill
      )}
      title={`Verification verdict: ${meta.title}`}
      aria-label={`Verification verdict: ${meta.label}`}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", styles.dot)} />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

export default StatusBadge;

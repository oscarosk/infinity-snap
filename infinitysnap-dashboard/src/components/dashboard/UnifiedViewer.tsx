"use client";

import React, { useMemo, useState } from "react";
import LogViewer from "@/components/dashboard/LogViewer";
import DiffViewer from "@/components/dashboard/DiffViewer";
import PatchViewer from "@/components/dashboard/PatchViewer";

type ViewerTab = "logs" | "diff" | "patch";
type Tone = "ok" | "warn" | "bad" | "neutral";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        // keep it consistently "dark glass" (works great in your InfinityShell)
        "rounded-3xl border border-white/10 bg-white/[0.06] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

function Badge({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
      : tone === "bad"
      ? "border-rose-300/20 bg-rose-300/10 text-rose-50"
      : tone === "warn"
      ? "border-amber-300/20 bg-amber-300/10 text-amber-50"
      : "border-white/10 bg-white/[0.06] text-white/80";

  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur",
        cls
      )}
      title={title}
    >
      {children}
    </span>
  );
}

function TabChip({
  active,
  children,
  onClick,
  disabled,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        "rounded-full px-4 py-2 text-xs font-semibold transition",
        disabled
          ? "cursor-not-allowed opacity-60 border border-white/10 bg-white/[0.05] text-white/40"
          : active
          ? "bg-white text-slate-900"
          : "border border-white/12 bg-white/[0.05] text-white/80 hover:bg-white/[0.08] hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function hasText(x: string) {
  return Boolean(x && x.trim().length > 0);
}

export default function UnifiedViewer({
  logsCombined,
  diff,
  patch,
  rawLogsHref,
  rawDiffHref,
  rawPatchHref,
  defaultTab = "logs",
  maxHeightClass = "max-h-[680px]",
}: {
  logsCombined: string;
  diff: string;
  patch: string;

  rawLogsHref?: string;
  rawDiffHref?: string;
  rawPatchHref?: string;

  defaultTab?: ViewerTab;
  maxHeightClass?: string;
}) {
  const hasLogs = useMemo(() => hasText(logsCombined), [logsCombined]);
  const hasDiff = useMemo(() => hasText(diff), [diff]);
  const hasPatch = useMemo(() => hasText(patch), [patch]);

  const initialTab = useMemo<ViewerTab>(() => {
    if (defaultTab === "logs" && hasLogs) return "logs";
    if (defaultTab === "diff" && hasDiff) return "diff";
    if (defaultTab === "patch" && hasPatch) return "patch";

    if (hasLogs) return "logs";
    if (hasDiff) return "diff";
    if (hasPatch) return "patch";
    return "logs";
  }, [defaultTab, hasLogs, hasDiff, hasPatch]);

  const [tab, setTab] = useState<ViewerTab>(initialTab);

  React.useEffect(() => {
    if (tab === "logs" && !hasLogs && (hasDiff || hasPatch)) {
      setTab(hasDiff ? "diff" : "patch");
    } else if (tab === "diff" && !hasDiff && (hasLogs || hasPatch)) {
      setTab(hasLogs ? "logs" : "patch");
    } else if (tab === "patch" && !hasPatch && (hasLogs || hasDiff)) {
      setTab(hasLogs ? "logs" : "diff");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLogs, hasDiff, hasPatch]);

  const headerRight = useMemo(() => {
    const href =
      tab === "logs" ? rawLogsHref : tab === "diff" ? rawDiffHref : rawPatchHref;
    if (!href) return null;

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cx(
          "rounded-full px-4 py-2 text-xs font-semibold transition",
          "border border-white/12 bg-white/[0.05] text-white/90 hover:bg-white/[0.08]"
        )}
        title="Open the raw backend endpoint"
      >
        Open raw
      </a>
    );
  }, [tab, rawLogsHref, rawDiffHref, rawPatchHref]);

  return (
    <GlassCard>
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Evidence</div>
            <div className="text-xs text-white/65">
              Proof artifacts: logs, diff, patch — no mock outputs.
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={hasLogs ? "ok" : "neutral"} title="Logs from sandbox execution">
                logs {hasLogs ? "✓" : "—"}
              </Badge>
              <Badge tone={hasDiff ? "ok" : "neutral"} title="Unified diff artifact">
                diff {hasDiff ? "✓" : "—"}
              </Badge>
              <Badge tone={hasPatch ? "ok" : "neutral"} title="Patch content produced by the system">
                patch {hasPatch ? "✓" : "—"}
              </Badge>
            </div>
          </div>

          <div className="shrink-0">{headerRight}</div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TabChip
            active={tab === "logs"}
            onClick={() => setTab("logs")}
            disabled={!hasLogs && (hasDiff || hasPatch)}
          >
            Logs
          </TabChip>

          <TabChip
            active={tab === "diff"}
            onClick={() => setTab("diff")}
            disabled={!hasDiff && (hasLogs || hasPatch)}
          >
            Diff
          </TabChip>

          <TabChip
            active={tab === "patch"}
            onClick={() => setTab("patch")}
            disabled={!hasPatch && (hasLogs || hasDiff)}
          >
            Patch
          </TabChip>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {tab === "logs" ? (
          <LogViewer
            title="Logs"
            subtitle="Searchable output captured from the sandbox / agent."
            text={logsCombined || ""}
            filename="run.log"
            maxHeightClass={maxHeightClass}
          />
        ) : null}

        {tab === "diff" ? (
          <DiffViewer
            title="Diff"
            subtitle="Unified diff produced by InfinitySnap."
            diff={diff || ""}
            filename="run.diff"
            maxHeightClass={maxHeightClass}
          />
        ) : null}

        {tab === "patch" ? (
          <PatchViewer
            title="Patch"
            subtitle="Copy/apply-ready patch content produced by InfinitySnap."
            patch={patch || ""}
            filename="run.patch"
            maxHeightClass={maxHeightClass}
            rawHref={rawPatchHref}
          />
        ) : null}

        {!hasLogs && !hasDiff && !hasPatch ? (
          <div className="mt-2 rounded-3xl border border-white/10 bg-white/[0.05] p-8 text-center text-xs text-white/70">
            No logs/diff/patch available yet for this run.
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

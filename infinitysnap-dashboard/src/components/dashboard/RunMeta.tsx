"use client";

import React, { useMemo, useState } from "react";
import StatusBadge from "@/components/dashboard/StatusBadge";
import ConfidenceBadge from "@/components/dashboard/ConfidenceBadge";
import { GlassCard, IconButton, cx } from "@/components/dashboard/ui";

type RunLike = any;

function Block({
  label,
  value,
  title,
  copyValue,
  showCopy,
}: {
  label: string;
  value: string;
  title?: string;
  copyValue?: string;
  showCopy?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!showCopy) return;
    const v = copyValue ?? value;
    if (!v || v === "—") return;
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {}
  };

  return (
    <div className="rounded-3xl border border-white/15 bg-white/40 p-3 backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-600 dark:text-slate-300">{label}</div>
        {showCopy ? (
          <IconButton onClick={copy} className="px-3 py-1 text-[11px]" title="Copy">
            {copied ? "Copied" : "Copy"}
          </IconButton>
        ) : null}
      </div>

      <div className="mt-1 truncate font-mono text-xs text-slate-900 dark:text-slate-100" title={title || value}>
        {value}
      </div>
    </div>
  );
}

function getRepo(run: RunLike) {
  return run?.repoPath || run?.repo || run?.meta?.repoPath || run?.meta?.repo || "—";
}
function getCommand(run: RunLike) {
  return run?.command || run?.meta?.command || "—";
}
function getStatus(run: RunLike) {
  return String(run?.status || run?.state || run?.verdict || "unknown");
}
function getStart(run: RunLike) {
  return run?.timestamp || run?.createdAt || run?.startedAt || run?.meta?.timestamp || "";
}
function getEnd(run: RunLike) {
  return run?.endedAt || run?.finishedAt || "";
}
function prettyTime(x: any): string {
  if (!x) return "—";
  const s = String(x);
  return s.includes("T") || s.includes(":") || s.includes("-") ? s : s;
}
function getDuration(run: RunLike) {
  const ms = run?.durationMs ?? run?.metrics?.durationMs ?? run?.timing?.durationMs ?? null;
  if (typeof ms === "number" && Number.isFinite(ms)) {
    const sec = ms / 1000;
    return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
  }
  return run?.duration || "—";
}
function normalizeConfidence(run: RunLike): number | null {
  const c = run?.confidence ?? run?.analysis?.confidence ?? null;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (c && typeof c === "object" && typeof c.score === "number" && Number.isFinite(c.score)) return c.score;
  return null;
}

export default function RunMeta({
  run,
  showCopy = true,
  compact = false,
}: {
  run: RunLike;
  showCopy?: boolean;
  compact?: boolean;
}) {
  if (!run) return null;

  const repo = useMemo(() => getRepo(run), [run]);
  const cmd = useMemo(() => getCommand(run), [run]);
  const status = useMemo(() => getStatus(run), [run]);
  const start = useMemo(() => prettyTime(getStart(run)), [run]);
  const end = useMemo(() => prettyTime(getEnd(run)), [run]);
  const dur = useMemo(() => getDuration(run), [run]);
  const confidence = useMemo(() => normalizeConfidence(run), [run]);

  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <ConfidenceBadge confidence={confidence} />
        </div>

        <div className="text-[11px] text-slate-600 dark:text-slate-300">Judge meta: repo + command + timing</div>
      </div>

      <div className={cx("mt-3 grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        <Block label="Repository" value={repo} title={repo} showCopy={showCopy} />
        <Block label="Command" value={cmd} title={cmd} showCopy={showCopy} />
        <Block label="Started" value={start} showCopy={false} />
        <Block label="Ended" value={end} showCopy={false} />
        <Block label="Duration" value={dur} showCopy={false} />
      </div>
    </GlassCard>
  );
}

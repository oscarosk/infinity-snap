"use client";

import Link from "next/link";
import React, { useMemo } from "react";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ConfidenceBadge } from "@/components/dashboard/ConfidenceBadge";

type RunLike = any;

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
        "rounded-3xl border border-white/15 bg-white/60 p-4 backdrop-blur-xl",
        "shadow-[0_10px_30px_-15px_rgba(0,0,0,0.25)] transition",
        "hover:bg-white/70 hover:-translate-y-0.5",
        "dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
        className
      )}
    >
      {children}
    </div>
  );
}

function Chip({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-white/15 bg-white/40 px-3 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
      title={title}
    >
      {children}
    </span>
  );
}

/* ---------------- field extractors ---------------- */

function getId(run: RunLike) {
  return String(run?.id || run?.runId || run?._id || "");
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

function getTimestamp(run: RunLike) {
  if (typeof run?.ts === "number" && Number.isFinite(run.ts)) return run.ts;
  return run?.timestamp || run?.createdAt || run?.startedAt || run?.meta?.timestamp || "";
}

function normalizeConfidence(run: RunLike): number | null {
  const c = run?.confidence ?? run?.analysis?.confidence ?? null;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (c && typeof c === "object" && typeof c.score === "number" && Number.isFinite(c.score))
    return c.score;
  return null;
}

function getDuration(run: RunLike) {
  const ms = run?.durationMs ?? run?.metrics?.durationMs ?? run?.timing?.durationMs ?? run?.runResult?.durationMs ?? null;

  if (typeof ms === "number" && Number.isFinite(ms)) {
    const sec = ms / 1000;
    return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
  }

  return run?.duration || "—";
}

/* ---------------- helpers ---------------- */

function timeAgo(ts: any) {
  const t =
    typeof ts === "number" && Number.isFinite(ts)
      ? ts
      : typeof ts === "string"
      ? new Date(ts).getTime()
      : new Date(String(ts || "")).getTime();

  if (!Number.isFinite(t)) return "—";

  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function RunCard({ run, compact = false }: { run: RunLike; compact?: boolean }) {
  const id = useMemo(() => getId(run), [run]);
  const repo = useMemo(() => getRepo(run), [run]);
  const cmd = useMemo(() => getCommand(run), [run]);
  const status = useMemo(() => getStatus(run), [run]);
  const ts = useMemo(() => getTimestamp(run), [run]);
  const dur = useMemo(() => getDuration(run), [run]);
  const confidence = useMemo(() => normalizeConfidence(run), [run]);

  if (!id) return null;

  return (
    <Link href={`/dashboard/runs/${encodeURIComponent(id)}`} className="block">
      <GlassCard className="group">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300">{id}</span>
              <span className="opacity-60 text-[11px] text-slate-500 dark:text-slate-400">•</span>
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{timeAgo(ts)}</span>
            </div>

            <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{repo}</div>

            {!compact ? (
              <div className="mt-1 truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={cmd}>
                {cmd}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={status} />
            <ConfidenceBadge confidence={confidence} compact />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Chip title="Duration reported by metrics">{dur}</Chip>

            {compact ? (
              <Chip title="Command (compact preview)">
                <span className="font-mono truncate max-w-[260px]">{cmd}</span>
              </Chip>
            ) : null}
          </div>

          <span className="text-[11px] text-slate-500 dark:text-slate-400 opacity-80">Click to inspect artifacts →</span>
        </div>
      </GlassCard>
    </Link>
  );
}

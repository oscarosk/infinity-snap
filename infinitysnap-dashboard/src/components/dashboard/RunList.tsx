"use client";

import React, { useEffect, useMemo, useState } from "react";
import { listRuns } from "@/lib/api";
import RunCard from "@/components/dashboard/RunCard";
import { FilterChip, GlassCard, IconButton, TextInput } from "@/components/dashboard/ui";

type RunLike = any;
type Bucket = "all" | "fixed" | "failed" | "skipped" | "running" | "unknown";

function getId(run: RunLike) {
  return String(run?.id || run?.runId || run?._id || "");
}
function getRepo(run: RunLike) {
  return run?.repoPath || run?.repo || run?.meta?.repoPath || run?.meta?.repo || "";
}
function getCommand(run: RunLike) {
  return run?.command || run?.meta?.command || "";
}
function getStatus(run: RunLike) {
  return String(run?.status || run?.state || run?.verdict || "unknown");
}
function getTimestamp(run: RunLike) {
  return run?.timestamp || run?.createdAt || run?.startedAt || run?.meta?.timestamp || "";
}
function safeTimeNum(ts: any) {
  const t = typeof ts === "number" ? ts : new Date(String(ts || "")).getTime();
  return Number.isFinite(t) ? t : 0;
}
function sortMostRecentFirst(a: RunLike, b: RunLike) {
  return safeTimeNum(getTimestamp(b)) - safeTimeNum(getTimestamp(a));
}

function normalizeBucket(statusRaw: string): Bucket {
  const s = String(statusRaw || "").toLowerCase();

  // safety outcomes count as skipped (policy-respect)
  if (s.startsWith("refused_")) return "skipped";
  if (s.includes("rolled_back")) return "skipped";

  if (["success", "passed", "pass", "fixed", "ok", "verified"].includes(s)) return "fixed";
  if (["fail", "failed", "error", "broken"].includes(s)) return "failed";
  if (["skipped", "skip"].includes(s)) return "skipped";
  if (["running", "pending", "queued", "analyzing", "patching", "verifying", "executing", "starting"].includes(s))
    return "running";

  return "unknown";
}

function SkeletonCard() {
  return (
    <div className="rounded-3xl border border-white/15 bg-white/40 p-4 backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="h-3 w-32 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-3 h-4 w-3/5 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="mt-4 h-3 w-28 animate-pulse rounded bg-black/10 dark:bg-white/10" />
    </div>
  );
}

export default function RunList({
  title = "Recent runs",
  subtitle = "Quick cards (great for demos). Click a run for full details.",
  limit = 8,
  autoRefreshMs = 10000,
}: {
  title?: string;
  subtitle?: string;
  limit?: number;
  autoRefreshMs?: number;
}) {
  const [runs, setRuns] = useState<RunLike[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<Bucket>("all");

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listRuns();
      const arr = Array.isArray(data) ? data : [];
      setRuns(arr.filter((r) => Boolean(getId(r))));
      setErr(null);
    } catch (e: any) {
      setRuns([]);
      setErr(e?.message || "Backend unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh(), autoRefreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshMs]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      all: runs.length,
      fixed: 0,
      failed: 0,
      skipped: 0,
      running: 0,
      unknown: 0,
    };
    for (const r of runs) c[normalizeBucket(getStatus(r))] += 1;
    return c;
  }, [runs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...runs]
      .sort(sortMostRecentFirst)
      .filter((r) => {
        const st = getStatus(r);
        const b = normalizeBucket(st);
        if (bucket !== "all" && b !== bucket) return false;

        if (!q) return true;
        const hay = `${getId(r)} ${getRepo(r)} ${getCommand(r)} ${st}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, Math.max(1, limit));
  }, [runs, query, bucket, limit]);

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
            {loading ? <span className="text-[11px] text-slate-500 dark:text-slate-300">Refreshing…</span> : null}
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{subtitle}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {err ? (
            <span className="text-xs text-rose-700 dark:text-rose-200">Backend offline</span>
          ) : (
            <span className="text-xs text-slate-600 dark:text-slate-300">{filtered.length} shown</span>
          )}

          <IconButton onClick={refresh} title="Refresh now">
            Refresh
          </IconButton>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={bucket === "all"} onClick={() => setBucket("all")}>
            All <span className="ml-1 opacity-70">({counts.all})</span>
          </FilterChip>
          <FilterChip active={bucket === "running"} onClick={() => setBucket("running")}>
            Running <span className="ml-1 opacity-70">({counts.running})</span>
          </FilterChip>
          <FilterChip active={bucket === "fixed"} onClick={() => setBucket("fixed")}>
            Fixed <span className="ml-1 opacity-70">({counts.fixed})</span>
          </FilterChip>
          <FilterChip active={bucket === "failed"} onClick={() => setBucket("failed")}>
            Failed <span className="ml-1 opacity-70">({counts.failed})</span>
          </FilterChip>
          <FilterChip active={bucket === "skipped"} onClick={() => setBucket("skipped")}>
            Skipped <span className="ml-1 opacity-70">({counts.skipped})</span>
          </FilterChip>
          <FilterChip active={bucket === "unknown"} onClick={() => setBucket("unknown")}>
            Unknown <span className="ml-1 opacity-70">({counts.unknown})</span>
          </FilterChip>
        </div>

        <div className="w-full lg:w-[420px]">
          <TextInput value={query} onChange={setQuery} placeholder="Search id / repo / command / status…" />
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {loading && runs.length === 0 ? (
          <div className="grid gap-3">
            {Array.from({ length: Math.min(4, limit) }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-white/15 bg-white/40 p-8 text-center text-xs text-slate-700 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            {err
              ? "Backend unreachable. Start backend on :4000."
              : "No runs yet. Start a run from the CLI and it will show up here."}
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((r) => (
              <RunCard key={getId(r)} run={r} compact />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300">
        <div>Auto-refresh every {Math.round(autoRefreshMs / 1000)}s</div>
        <div className="font-mono opacity-80">{err ? "offline" : "live"}</div>
      </div>
    </GlassCard>
  );
}

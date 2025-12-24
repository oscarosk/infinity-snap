"use client";

import React, { useEffect, useMemo, useState } from "react";
import { listRuns } from "@/lib/api";
import { cx, Tone } from "@/components/dashboard/ui";

type RunLike = any;

function StatCard({
  title,
  value,
  sub,
  tone = "neutral",
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
}) {
  const ring =
    tone === "ok"
      ? "border-emerald-500/15"
      : tone === "bad"
      ? "border-rose-500/15"
      : tone === "warn"
      ? "border-amber-500/15"
      : "border-white/15";

  const bg =
    tone === "ok"
      ? "bg-emerald-500/10"
      : tone === "bad"
      ? "bg-rose-500/10"
      : tone === "warn"
      ? "bg-amber-500/10"
      : "bg-white/60 dark:bg-white/5";

  return (
    <div
      className={cx(
        "rounded-3xl border p-4 backdrop-blur-xl",
        "shadow-[0_10px_30px_-15px_rgba(0,0,0,0.25)]",
        "dark:border-white/10",
        ring,
        bg
      )}
    >
      <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{sub}</div> : null}
    </div>
  );
}

function getTimestamp(run: RunLike) {
  return run?.timestamp || run?.createdAt || run?.startedAt || run?.meta?.timestamp || "";
}
function getStatus(run: RunLike) {
  return String(run?.status || run?.state || run?.verdict || "unknown");
}
function getDurationMs(run: RunLike): number | null {
  const ms = run?.durationMs ?? run?.metrics?.durationMs ?? run?.timing?.durationMs ?? null;
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

function normalizeBucket(statusRaw: string): "fixed" | "failed" | "skipped" | "running" | "unknown" {
  const s = String(statusRaw || "").toLowerCase();
  if (s.startsWith("refused_")) return "skipped";
  if (["success", "passed", "pass", "fixed", "ok", "verified"].includes(s)) return "fixed";
  if (["fail", "failed", "error", "broken"].includes(s)) return "failed";
  if (["skipped", "skip"].includes(s)) return "skipped";
  if (["running", "pending", "queued", "analyzing", "patching", "verifying", "executing", "starting"].includes(s))
    return "running";
  return "unknown";
}

function fmtAgo(ts: string) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "—";
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtMs(ms: number | null) {
  if (ms == null) return "—";
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(2)}s`;
  return `${(sec / 60).toFixed(1)}m`;
}

export default function StatsCards() {
  const [runs, setRuns] = useState<RunLike[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listRuns();
      setRuns(Array.isArray(data) ? data : []);
      setErr(null);
      setLastSync(new Date());
    } catch (e: any) {
      setRuns([]);
      setErr(e?.message || "Backend unavailable");
      setLastSync(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const all = Array.isArray(runs) ? runs : [];

    const counts = { total: all.length, fixed: 0, failed: 0, running: 0, skipped: 0, unknown: 0 };
    let mostRecentTs: string | null = null;
    const durationMs: number[] = [];

    for (const r of all) {
      const bucket = normalizeBucket(getStatus(r));
      counts[bucket]++;

      const ts = String(getTimestamp(r) || "");
      const t = new Date(ts).getTime();
      if (Number.isFinite(t)) {
        if (!mostRecentTs) mostRecentTs = ts;
        else {
          const cur = new Date(mostRecentTs).getTime();
          if (Number.isFinite(cur) && t > cur) mostRecentTs = ts;
        }
      }

      const ms = getDurationMs(r);
      if (ms != null && bucket !== "running") durationMs.push(ms);
    }

    const denom = counts.fixed + counts.failed;
    const passRate = denom > 0 ? Math.round((counts.fixed / denom) * 100) : null;
    const avg = durationMs.length ? durationMs.reduce((a, b) => a + b, 0) / durationMs.length : null;

    return { counts, mostRecentTs, passRate, avgDurationMs: avg };
  }, [runs]);

  const passTone: Tone =
    stats.passRate == null ? "neutral" : stats.passRate >= 70 ? "ok" : stats.passRate >= 40 ? "warn" : "bad";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">Overview</div>

        <div className="flex items-center gap-2">
          {err ? (
            <span className="text-xs text-rose-700 dark:text-rose-200">Backend offline</span>
          ) : (
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              {loading ? "Refreshing…" : "Live"}
              {lastSync ? ` · synced ${lastSync.toLocaleTimeString()}` : ""}
            </span>
          )}

          <button
            type="button"
            onClick={refresh}
            className={cx(
              "rounded-full px-4 py-2 text-xs font-semibold transition shadow-sm",
              "border border-white/15 bg-white/50 text-slate-900 backdrop-blur hover:bg-white/70",
              "dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            )}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total runs" value={stats.counts.total} sub="All captured executions" tone="neutral" />

        <StatCard
          title="Resolved pass rate"
          value={stats.passRate == null ? "—" : `${stats.passRate}%`}
          sub={
            <span>
              Fixed <span className="font-mono">{stats.counts.fixed}</span> · Failed{" "}
              <span className="font-mono">{stats.counts.failed}</span>
            </span>
          }
          tone={passTone}
        />

        <StatCard
          title="Active runs"
          value={stats.counts.running}
          sub="Queued / analyzing / verifying"
          tone={stats.counts.running > 0 ? "warn" : "neutral"}
        />

        <StatCard
          title="Avg duration"
          value={fmtMs(stats.avgDurationMs)}
          sub={
            <span>
              Last run: <span className="font-mono">{stats.mostRecentTs ? fmtAgo(stats.mostRecentTs) : "—"}</span>
            </span>
          }
          tone="neutral"
        />
      </div>

      <div className="text-[11px] text-slate-600 dark:text-slate-300">
        Buckets — fixed {stats.counts.fixed} · failed {stats.counts.failed} · running {stats.counts.running} · skipped{" "}
        {stats.counts.skipped} · unknown {stats.counts.unknown}
      </div>
    </div>
  );
}

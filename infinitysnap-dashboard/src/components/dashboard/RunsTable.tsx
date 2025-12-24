// src/components/dashboard/RunsTable.tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { listRuns, API_BASE } from "@/lib/api";
import StatusBadge from "@/components/dashboard/StatusBadge";
import {
  Badge,
  FilterChip,
  GlassCard,
  IconButton,
  Select,
  TextInput,
  Tone,
  cx,
} from "@/components/dashboard/ui";

type RunLike = any;

type Bucket = "all" | "running" | "fixed" | "failed" | "skipped" | "unknown";
type SortKey = "newest" | "duration" | "confidence";

type RunDetailIndex = {
  runId: string;
  status?: string;
  hasPatch?: boolean;
  hasDiff?: boolean;
  hasTimeline?: boolean;
  confidence?: any;
  durationMs?: number;
};

function getId(run: RunLike) {
  return String(run?.id || run?.runId || run?._id || "");
}

function getTimestamp(run: RunLike) {
  if (typeof run?.ts === "number" && Number.isFinite(run.ts)) return run.ts;
  return (
    run?.timestamp ||
    run?.createdAt ||
    run?.startedAt ||
    run?.meta?.timestamp ||
    ""
  );
}

function safeTimeLabel(value: any) {
  if (!value) return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function normalizeBucket(statusRaw: string): Bucket {
  const s = String(statusRaw || "").toLowerCase();

  if (s.startsWith("refused_")) return "skipped";
  if (s.includes("rolled_back")) return "skipped";

  if (
    ["verified", "fixed", "success", "passed", "pass", "ok", "finished"].includes(
      s
    )
  )
    return "fixed";
  if (["failed", "fail", "error", "broken"].includes(s)) return "failed";
  if (["skipped", "skip"].includes(s)) return "skipped";
  if (
    [
      "running",
      "pending",
      "queued",
      "analyzing",
      "patching",
      "verifying",
      "executing",
      "starting",
    ].includes(s)
  )
    return "running";

  return "unknown";
}

function toneForBucket(b: Bucket): Tone {
  if (b === "fixed") return "ok";
  if (b === "failed") return "bad";
  if (b === "running") return "warn";
  return "neutral";
}

async function fetchRunDetailIndex(
  runId: string
): Promise<RunDetailIndex | null> {
  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    console.warn(
      "[run] failed",
      runId,
      res.status,
      await res.text().catch(() => "")
    );
    return null;
  }

  const json: any = await res.json().catch(() => null);
  if (!json) return null;

  const data =
    json && typeof json === "object" && json.data && typeof json.data === "object"
      ? json.data
      : json;

  const status = String(
    data?.status || data?.state || data?.verdict || "unknown"
  );

  const hasDiff = Boolean(data?.diffPath) || Boolean(data?.diff);
  const hasPatch = Boolean(data?.patchPath) || Boolean(data?.patch);
  const hasTimeline = Array.isArray(data?.steps) ? data.steps.length > 0 : false;

  const durationMs =
    typeof data?.runResult?.durationMs === "number"
      ? data.runResult.durationMs
      : typeof data?.durationMs === "number"
      ? data.durationMs
      : typeof data?.metrics?.durationMs === "number"
      ? data.metrics.durationMs
      : undefined;

  const confidence = data?.analysis?.confidence ?? data?.confidence ?? undefined;

  return {
    runId,
    status,
    hasDiff,
    hasPatch,
    hasTimeline,
    durationMs,
    confidence,
  };
}

function shortStatus(s: any) {
  const x = String(s || "unknown");
  return x.length > 32 ? `${x.slice(0, 32)}…` : x;
}

/** -----------------------------------------
 *  Light-chip pills (BLACK text everywhere)
 *  ---------------------------------------- */

const pillBase = cx(
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-[11px] font-semibold transition",
  "border",
  "ring-1 ring-white/10",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
);

// NOTE: black text for all pills
const pillText = "text-slate-950";

function PrimaryPill({
  href,
  children,
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        className={cx(
          pillBase,
          pillText,
          "cursor-not-allowed opacity-50",
          "border-white/25 bg-white/60"
        )}
      >
        {children}
      </span>
    );
  }

  // Lighter gradient so black text stays readable
  return (
    <Link
      href={href}
      className={cx(
        pillBase,
        pillText,
        "border-white/25",
        "bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-cyan-200",
        "shadow-[0_16px_48px_-32px_rgba(255,255,255,0.35)]",
        "hover:brightness-105 hover:-translate-y-0.5"
      )}
    >
      {children}
    </Link>
  );
}

function SecondaryPill({
  href,
  children,
  external,
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  disabled?: boolean;
}) {
  const cls = cx(
    pillBase,
    pillText,
    disabled ? "cursor-not-allowed opacity-50" : "",
    "border-white/25 bg-white/70",
    "hover:bg-white/85 hover:-translate-y-0.5"
  );

  if (disabled) return <span className={cls}>{children}</span>;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function GhostPill({
  onClick,
  children,
  title,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      className={cx(
        pillBase,
        pillText,
        disabled ? "cursor-not-allowed opacity-50" : "",
        "border-white/25 bg-white/60",
        "hover:bg-white/80 hover:-translate-y-0.5"
      )}
    >
      {children}
    </button>
  );
}

// Small “artifact chips” with black text
function TinyPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "ok" | "bad" | "warn" | "neutral" | "violet";
}) {
  const bg =
    tone === "ok"
      ? "bg-emerald-200 border-emerald-300/60"
      : tone === "bad"
      ? "bg-rose-200 border-rose-300/60"
      : tone === "warn"
      ? "bg-amber-200 border-amber-300/60"
      : tone === "violet"
      ? "bg-violet-200 border-violet-300/60"
      : "bg-slate-200 border-slate-300/60";

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        "ring-1 ring-white/10",
        "text-slate-950",
        bg
      )}
    >
      {children}
    </span>
  );
}

function bucketToTinyTone(b: Bucket) {
  if (b === "fixed") return "ok";
  if (b === "failed") return "bad";
  if (b === "running") return "warn";
  if (b === "skipped") return "violet";
  return "neutral";
}

export default function RunsTable() {
  const [runs, setRuns] = useState<RunLike[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const [details, setDetails] = useState<Record<string, RunDetailIndex>>({});
  const inflight = useRef<Set<string>>(new Set());

  const refresh = async () => {
    setLoading(true);
    try {
      const arr = await listRuns();
      const normalized = Array.isArray(arr)
        ? arr
        : Array.isArray((arr as any)?.runs)
        ? (arr as any).runs
        : [];
      setRuns(normalized);
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
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sortMostRecentFirst(a: RunLike, b: RunLike) {
    const ta =
      typeof getTimestamp(a) === "number"
        ? (getTimestamp(a) as number)
        : new Date(getTimestamp(a)).getTime();
    const tb =
      typeof getTimestamp(b) === "number"
        ? (getTimestamp(b) as number)
        : new Date(getTimestamp(b)).getTime();
    const aa = Number.isFinite(ta) ? ta : 0;
    const bb = Number.isFinite(tb) ? tb : 0;
    return bb - aa;
  }

  const baseRows = useMemo(() => [...runs].sort(sortMostRecentFirst), [runs]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    return baseRows.filter((r) => {
      const id = getId(r);
      const st =
        details[id]?.status ||
        String(r?.status || r?.state || r?.verdict || "unknown");
      const b = normalizeBucket(st);

      if (bucket !== "all" && b !== bucket) return false;
      if (!q) return true;

      const repo = String(
        r?.repoPath || r?.repo || r?.meta?.repoPath || r?.meta?.repo || ""
      );
      const cmd = String(r?.command || r?.meta?.command || "");
      const hay = `${id} ${repo} ${cmd} ${st}`.toLowerCase();
      return hay.includes(q);
    });
  }, [baseRows, query, bucket, details]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    if (sortKey === "newest") return list;

    if (sortKey === "duration") {
      return list.sort((a, b) => {
        const ia = details[getId(a)];
        const ib = details[getId(b)];
        const da = Number((ia as any)?.durationMs ?? 0);
        const db = Number((ib as any)?.durationMs ?? 0);
        return db - da;
      });
    }

    return list.sort((a, b) => {
      const ia: any = details[getId(a)];
      const ib: any = details[getId(b)];

      const ca =
        typeof ia?.confidence === "number"
          ? ia.confidence
          : typeof ia?.confidence?.score === "number"
          ? ia.confidence.score
          : typeof ia?.confidence?.confidence === "number"
          ? ia.confidence.confidence
          : 0;

      const cb =
        typeof ib?.confidence === "number"
          ? ib.confidence
          : typeof ib?.confidence?.score === "number"
          ? ib.confidence.score
          : typeof ib?.confidence?.confidence === "number"
          ? ib.confidence.confidence
          : 0;

      return cb - ca;
    });
  }, [rows, sortKey, details]);

  // fetch details for visible rows only
  useEffect(() => {
    const visible = sortedRows.slice(0, 25);
    const ids = visible.map((r) => getId(r)).filter(Boolean);

    (async () => {
      for (const id of ids) {
        if (details[id]) continue;
        if (inflight.current.has(id)) continue;
        inflight.current.add(id);

        try {
          const idx = await fetchRunDetailIndex(id);
          if (idx) setDetails((prev) => ({ ...prev, [id]: idx }));
        } finally {
          inflight.current.delete(id);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRows]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      all: runs.length,
      running: 0,
      fixed: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
    };

    for (const r of runs) {
      const id = getId(r);
      const st =
        details[id]?.status ||
        String(r?.status || r?.state || r?.verdict || "unknown");
      c[normalizeBucket(st)] += 1;
    }
    return c;
  }, [runs, details]);

  const copy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  return (
    <GlassCard className="overflow-hidden p-0">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-white">Run history</div>
            {loading ? (
              <span className="text-[11px] text-white/60">Refreshing…</span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-white/70">
            Table on desktop · cards on mobile · details fetched via{" "}
            <span className="font-mono text-white/85">/runs/:id</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {err ? (
            <Badge tone="bad" title={err}>
              Backend offline
            </Badge>
          ) : (
            <Badge tone="neutral">{sortedRows.length} shown</Badge>
          )}
          <IconButton onClick={refresh} title="Refresh now">
            Refresh
          </IconButton>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className={cx(
            "flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-1",
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          )}
        >
          <FilterChip active={bucket === "all"} onClick={() => setBucket("all")}>
            All <span className="ml-1 text-[11px] opacity-70">({counts.all})</span>
          </FilterChip>
          <FilterChip
            active={bucket === "running"}
            onClick={() => setBucket("running")}
          >
            Running{" "}
            <span className="ml-1 text-[11px] opacity-70">({counts.running})</span>
          </FilterChip>
          <FilterChip
            active={bucket === "fixed"}
            onClick={() => setBucket("fixed")}
          >
            Fixed <span className="ml-1 text-[11px] opacity-70">({counts.fixed})</span>
          </FilterChip>
          <FilterChip
            active={bucket === "failed"}
            onClick={() => setBucket("failed")}
          >
            Failed{" "}
            <span className="ml-1 text-[11px] opacity-70">({counts.failed})</span>
          </FilterChip>
          <FilterChip
            active={bucket === "skipped"}
            onClick={() => setBucket("skipped")}
          >
            Skipped{" "}
            <span className="ml-1 text-[11px] opacity-70">({counts.skipped})</span>
          </FilterChip>
          <FilterChip
            active={bucket === "unknown"}
            onClick={() => setBucket("unknown")}
          >
            Unknown{" "}
            <span className="ml-1 text-[11px] opacity-70">({counts.unknown})</span>
          </FilterChip>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="w-full sm:w-[380px]">
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="Search id / repo / status…"
            />
          </div>
          <Select
            value={sortKey}
            onChange={(v: string) => setSortKey(v as SortKey)}
            options={[
              { value: "newest", label: "Sort: newest" },
              { value: "duration", label: "Sort: duration" },
              { value: "confidence", label: "Sort: confidence" },
            ]}
          />
        </div>
      </div>

      {/* MOBILE: cards */}
      <div className="block p-3 md:hidden">
        {sortedRows.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 text-center text-xs text-white/70">
            {err
              ? "Backend unreachable. Start backend on :4000."
              : "No runs match this filter yet."}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedRows.map((run, idx) => {
              const id = getId(run);
              const ts = safeTimeLabel(getTimestamp(run));
              const di = details[id];
              const status = di?.status || "loading…";

              const b = normalizeBucket(status);

              const hasPatch = Boolean(di?.hasPatch);
              const hasDiff = Boolean(di?.hasDiff);
              const hasTimeline = Boolean(di?.hasTimeline);

              const hasId = Boolean(id);

              const timelineHref = hasId
                ? `${API_BASE}/runs/${encodeURIComponent(id)}/timeline`
                : "";

              return (
                <div
                  key={id || `${ts}-${idx}`}
                  className={cx(
                    "rounded-3xl border bg-white/[0.06] p-3 backdrop-blur",
                    "border-white/12 hover:border-white/18 hover:bg-white/[0.09] transition"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-white/90">
                        {id || "—"}
                      </div>
                      <div className="mt-1 text-[11px] text-white/60">{ts}</div>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge status={shortStatus(status)} />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <TinyPill tone={hasTimeline ? "ok" : "neutral"}>
                      timeline {hasTimeline ? "✓" : "—"}
                    </TinyPill>
                    <TinyPill tone={hasDiff ? "ok" : "neutral"}>
                      diff {hasDiff ? "✓" : "—"}
                    </TinyPill>
                    <TinyPill tone={hasPatch ? "ok" : "neutral"}>
                      patch {hasPatch ? "✓" : "—"}
                    </TinyPill>
                    <TinyPill tone={bucketToTinyTone(b)}>{b}</TinyPill>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <PrimaryPill
                      href={`/runs/${encodeURIComponent(id)}`}
                      disabled={!hasId}
                    >
                      Open run
                    </PrimaryPill>

                    <SecondaryPill
                      href={`${API_BASE}/runs/${encodeURIComponent(id)}`}
                      external
                      disabled={!hasId}
                    >
                      Run JSON
                    </SecondaryPill>

                    <SecondaryPill href={timelineHref} external disabled={!hasId}>
                      Timeline
                    </SecondaryPill>

                    <GhostPill
                      onClick={() => copy(id)}
                      title="Copy runId"
                      disabled={!hasId}
                    >
                      Copy
                    </GhostPill>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DESKTOP: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[1200px] table-auto divide-y divide-white/10 text-sm">
          <thead className="bg-white/[0.04]">
            <tr>
              <th className="w-[260px] px-4 py-2 text-left text-xs font-semibold uppercase text-white/70">
                Run ID
              </th>
              <th className="w-[220px] px-4 py-2 text-left text-xs font-semibold uppercase text-white/70">
                Timestamp
              </th>
              <th className="w-[220px] px-4 py-2 text-left text-xs font-semibold uppercase text-white/70">
                Status
              </th>
              <th className="min-w-[320px] px-4 py-2 text-left text-xs font-semibold uppercase text-white/70">
                Artifacts
              </th>
              <th className="min-w-[420px] px-4 py-2 text-left text-xs font-semibold uppercase text-white/70">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10 [&>tr:nth-child(odd)]:bg-white/[0.02]">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-xs text-white/70">
                  {err
                    ? "Backend unreachable. Start backend on :4000."
                    : "No runs match this filter yet. Start a run from the CLI."}
                </td>
              </tr>
            ) : (
              sortedRows.map((run, idx) => {
                const id = getId(run);
                const key = id || `${String(getTimestamp(run))}-${idx}`;
                const ts = safeTimeLabel(getTimestamp(run));

                const di = details[id];
                const status = di?.status || "loading…";
                const b = normalizeBucket(status);

                const hasPatch = Boolean(di?.hasPatch);
                const hasDiff = Boolean(di?.hasDiff);
                const hasTimeline = Boolean(di?.hasTimeline);

                const hasId = Boolean(id);

                const timelineHref = hasId
                  ? `${API_BASE}/runs/${encodeURIComponent(id)}/timeline`
                  : "";

                return (
                  <tr key={key} className="align-top transition hover:bg-white/[0.06]">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap overflow-hidden text-ellipsis text-white/90">
                      {hasId ? (
                        <Link
                          className="hover:underline"
                          href={`/runs/${encodeURIComponent(id)}`}
                        >
                          {id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-4 py-3 text-xs text-white/70 whitespace-nowrap">
                      {ts}
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={shortStatus(status)} />
                        {String(status).startsWith("refused_") ? (
                          <span className="text-[11px] text-amber-200/90">
                            autonomy refused (policy)
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <TinyPill tone={hasTimeline ? "ok" : "neutral"}>
                          timeline {hasTimeline ? "✓" : "—"}
                        </TinyPill>
                        <TinyPill tone={hasDiff ? "ok" : "neutral"}>
                          diff {hasDiff ? "✓" : "—"}
                        </TinyPill>
                        <TinyPill tone={hasPatch ? "ok" : "neutral"}>
                          patch {hasPatch ? "✓" : "—"}
                        </TinyPill>
                        <TinyPill tone={bucketToTinyTone(b)}>{b}</TinyPill>
                      </div>
                      <div className="mt-1 text-[11px] text-white/55">
                        {di ? "from /runs/:id" : "fetching…"}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <PrimaryPill
                          href={`/runs/${encodeURIComponent(id)}`}
                          disabled={!hasId}
                        >
                          Open run
                        </PrimaryPill>

                        <SecondaryPill
                          href={`${API_BASE}/runs/${encodeURIComponent(id)}`}
                          external
                          disabled={!hasId}
                        >
                          Run JSON
                        </SecondaryPill>

                        <SecondaryPill
                          href={timelineHref}
                          external
                          disabled={!hasId}
                        >
                          Timeline
                        </SecondaryPill>

                        <GhostPill
                          onClick={() => copy(id)}
                          title="Copy runId"
                          disabled={!hasId}
                        >
                          Copy
                        </GhostPill>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 text-[11px] text-white/60">
        <div>Auto-refresh every 10s · Details fetched for visible rows only</div>
        <div className="font-mono">{err ? "offline" : "live"}</div>
      </div>
    </GlassCard>
  );
}

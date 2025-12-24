"use client";

import { useEffect, useMemo, useState } from "react";
import StatsCards from "@/components/dashboard/StatsCards";
import RunsTable from "@/components/dashboard/RunsTable";
import { BACKEND_URL, API_BASE, listRuns } from "@/lib/api";
import { Badge, GlassCard, IconButton, cx } from "@/components/dashboard/ui";

function StatusDot({ online }: { online: boolean | null }) {
  const cls =
    online === null ? "bg-slate-400" : online ? "bg-emerald-400" : "bg-rose-400";

  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <span
        className={cx(
          "absolute inline-flex h-full w-full rounded-full opacity-60",
          cls,
          online ? "animate-ping" : ""
        )}
      />
      <span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", cls)} />
    </span>
  );
}

function CodeSnippet({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {}
  };

  return (
    <div
      className={cx(
        "rounded-2xl border p-3 backdrop-blur transition",
        "border-white/10 bg-white/[0.08] hover:bg-white/[0.12]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-white/90">
          {value}
        </pre>
        <button
          type="button"
          onClick={copy}
          className={cx(
            "shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
            "border-white/15 bg-white/[0.10] text-white hover:bg-white/[0.18]"
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function prettyTime(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardHomePage() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [runCount, setRunCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showProof, setShowProof] = useState(false);

  const refreshPing = async () => {
    setLoading(true);
    try {
      const resp = await listRuns();
      const runs = Array.isArray(resp) ? resp : (resp as any)?.runs;

      setOnline(true);
      setErr(null);
      setLastSync(new Date());
      setRunCount(Array.isArray(runs) ? runs.length : 0);
    } catch (e: any) {
      setOnline(false);
      setErr(e?.message || "Backend unreachable");
      setLastSync(new Date());
      setRunCount(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshPing();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(refreshPing, 10000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const statusBadge = useMemo(() => {
    if (online === null) {
      return (
        <Badge tone="neutral" title="Checking /runs…">
          <StatusDot online={online} />
          Checking
        </Badge>
      );
    }
    if (online) {
      return (
        <Badge tone="ok" title="Dashboard is reading live from /runs">
          <StatusDot online={online} />
          Connected
          {typeof runCount === "number" ? (
            <span className="text-emerald-200/70">
              · {runCount} run{runCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </Badge>
      );
    }
    return (
      <Badge tone="bad" title={err || "Backend is not reachable"}>
        <StatusDot online={online} />
        Offline
      </Badge>
    );
  }, [online, runCount, err]);

  const quickStartBackend = `cd backend && npm run dev`;
  const quickStartCli =
    'cd cli && npx ts-node src/index.ts start --path ../samples/demo-repo --command "node failing-test.js"';

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.08] p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-500/25 via-fuchsia-500/15 to-cyan-400/15 blur-3xl" />
          <div className="absolute -bottom-40 right-[-120px] h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-emerald-500/12 via-sky-500/10 to-violet-500/12 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.35)_55%,rgba(0,0,0,0.65)_100%)]" />
        </div>

        <div className="relative">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  Dashboard
                </h1>
                {statusBadge}
                <span className="text-[11px] text-white/55">
                  Last sync: {prettyTime(lastSync)}
                </span>
                {loading ? <Badge tone="warn">Refreshing…</Badge> : null}
              </div>

              <p className="mt-2 max-w-3xl text-sm text-white/80">
                Evidence-first runs: logs → diff/patch → verification.{" "}
                <span className="font-semibold text-white">
                  No vibes, just receipts.
                </span>
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-2 text-xs font-semibold text-white/85 backdrop-blur transition hover:bg-white/[0.12]">
                  <input
                    type="checkbox"
                    className="accent-white"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                  Auto refresh
                  <span className="text-[11px] text-white/55">(10s)</span>
                </label>

                <IconButton onClick={refreshPing}>Refresh</IconButton>

                {/* Primary CTA */}
                <a
                  href={`${API_BASE}/runs`}
                  target="_blank"
                  rel="noreferrer"
                  className={cx(
                    "inline-flex items-center rounded-full px-4 py-2 text-xs font-semibold",
                    "border border-white/15 text-white",
                    "bg-gradient-to-r from-violet-500/90 via-fuchsia-500/85 to-cyan-400/80",
                    "shadow-[0_12px_40px_-20px_rgba(255,255,255,0.25)]",
                    "hover:brightness-110"
                  )}
                >
                  Open /runs JSON
                </a>

                <IconButton onClick={() => setShowProof((v) => !v)}>
                  {showProof ? "Hide" : "Show"} proof panel
                </IconButton>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-2 backdrop-blur">
              <div className="text-[11px] text-white/55">Backend</div>
              <div className="mt-0.5 max-w-[420px] truncate font-mono text-[12px] text-white/85">
                {BACKEND_URL}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Offline */}
      {online === false && (
        <GlassCard className="border-rose-500/25 bg-rose-500/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-rose-200">
                Backend unreachable
              </p>
              <p className="mt-1 text-xs text-rose-200/80">
                Start the backend on port <span className="font-mono">4000</span>.
                {err ? <span className="ml-2">({err})</span> : null}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:w-[560px]">
              <CodeSnippet value={quickStartBackend} />
              <CodeSnippet value={quickStartCli} />
            </div>
          </div>
        </GlassCard>
      )}

      {/* Proof panel */}
      {showProof && (
        <GlassCard>
          <div className="flex justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                Developer / Judge Proof
              </p>
              <p className="mt-1 text-xs text-white/65">
                These links prove the UI is backed by real artifacts.
              </p>
            </div>
            <span className="text-[11px] text-white/55 font-mono">
              {BACKEND_URL}
            </span>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <CodeSnippet value={`${API_BASE}/runs`} />
            <CodeSnippet value={`${API_BASE}/runs/<id>/logs`} />
            <CodeSnippet value={`${API_BASE}/runs/<id>/diff`} />
            <CodeSnippet value={`${API_BASE}/runs/<id>/patch`} />
          </div>
        </GlassCard>
      )}

      {/* Main content */}
      <StatsCards />
      <RunsTable />
    </div>
  );
}

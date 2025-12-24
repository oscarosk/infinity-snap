// src/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * InfinitySnap API base:
 * - If NEXT_PUBLIC_BACKEND_URL is set, call backend directly (e.g., http://127.0.0.1:4000)
 * - Otherwise use same-origin "/api/v1" and rely on Next rewrites in dev.
 */
const ROOT = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");
const API_BASE = ROOT ? `${ROOT}/api/v1` : "/api/v1";

async function apiFetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API ${res.status}`);
  }
  return res.json();
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function prettyTime(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function StatusDot({ online }: { online: boolean | null }) {
  const cls =
    online === null ? "bg-slate-500" : online ? "bg-emerald-400" : "bg-rose-400";
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

function Badge({
  tone,
  children,
  title,
}: {
  tone: "ok" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
  title?: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : tone === "bad"
      ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
      : tone === "warn"
      ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
      : "border-white/10 bg-white/5 text-slate-200";

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
        "rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.55)] backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      // Force black text even if some global anchor styles override it
      className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold !text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/20"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-slate-100 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/[0.10] focus:outline-none focus:ring-2 focus:ring-white/10";

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
    <div className="group rounded-2xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-slate-100/90">
          {value}
        </pre>

        <button
          type="button"
          onClick={copy}
          className={cx(
            "shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
            "border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/[0.10]"
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showJudgeProof, setShowJudgeProof] = useState(false);

  // Hydration-safe origin for display-only URLs
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const DISPLAY_API_BASE = `${origin}${API_BASE}`;

  const refresh = async () => {
    try {
      await apiFetchJSON("/health");
      const list = await apiFetchJSON<any>("/runs");
      const arr = Array.isArray(list) ? list : Array.isArray(list?.runs) ? list.runs : [];
      setOnline(true);
      setRuns(arr);
      setErr(null);
      setLastSync(new Date());
    } catch (e: any) {
      setOnline(false);
      setRuns([]);
      setErr(e?.message || "Backend unreachable");
      setLastSync(new Date());
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCount = runs.length;

  const latestRunId = useMemo(() => {
    if (!runs.length) return "";
    const getTs = (r: any) =>
      r?.timestamp || r?.createdAt || r?.startedAt || r?.meta?.timestamp || "";
    const sorted = [...runs].sort((a, b) => {
      const ta = new Date(getTs(a)).getTime();
      const tb = new Date(getTs(b)).getTime();
      if (Number.isFinite(tb) && Number.isFinite(ta)) return tb - ta;
      return 0;
    });
    const top = sorted[0];
    return String(top?.id || top?.runId || top?._id || "");
  }, [runs]);

  const statusLabel = online === null ? "Checking" : online ? "Connected" : "Offline";

  const quickBackend = "cd backend && npm run dev";
  const quickCli =
    'cd cli && npx ts-node src/index.ts start --path ../samples/demo-repo --command "node failing-test.js"';

  return (
    <div className="min-h-screen text-slate-100">
      {/* Background (InfinitySnap) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[#070A12]" />
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-500/35 via-fuchsia-500/20 to-cyan-400/20 blur-3xl" />
        <div className="absolute -bottom-40 right-[-120px] h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-emerald-500/20 via-sky-500/15 to-violet-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] [background-size:26px_26px]" />
      </div>

      {/* Reduced vertical padding so content fits without scrolling */}
      <div className="mx-auto max-w-6xl px-4 py-4">
        {/* Top bar */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-fuchsia-500 text-white shadow-sm">
              <span className="text-xl font-semibold">∞</span>
            </div>

            <div className="leading-tight">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold tracking-tight">InfinitySnap</p>
                <span className="hidden text-[11px] text-slate-300/70 sm:inline">
                  evidence-first · patch proposals · verifier decides
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  tone={online === null ? "neutral" : online ? "ok" : "bad"}
                  title={online ? "Live connection to backend" : err || "Backend is not reachable"}
                >
                  <StatusDot online={online} />
                  {statusLabel}
                  {online ? (
                    <span className="text-slate-200/70">
                      · {runCount} run{runCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </Badge>

                <span className="text-[11px] text-slate-300/70">
                  Last sync: {prettyTime(lastSync)}
                </span>
              </div>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <SecondaryButton href="/dashboard">Open dashboard</SecondaryButton>
            <SecondaryButton href={`${DISPLAY_API_BASE}/runs`} external>
              Open /runs JSON
            </SecondaryButton>
          </nav>
        </header>

        {/* Hero */}
        <main className="mt-6 grid gap-5 md:grid-cols-[1.2fr_0.8fr] md:items-start">
          <section className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-200 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              Judge-friendly proof. No vibes.
            </div>

            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Fix failures with{" "}
              <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">
                receipts
              </span>
              .
            </h1>

            <p className="max-w-2xl text-sm leading-relaxed text-slate-200/70">
              Run a command in a safe sandbox, capture stdout/stderr, propose a patch, apply it, and verify the
              result — with every artifact visible in the UI.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton href="/dashboard">Open live dashboard</PrimaryButton>

              {online && latestRunId ? (
                <SecondaryButton href={`/runs/${encodeURIComponent(latestRunId)}`}>
                  Open latest run →
                </SecondaryButton>
              ) : (
                <SecondaryButton href="/dashboard">View runs</SecondaryButton>
              )}
            </div>

            {/* Offline callout */}
            {online === false ? (
              <GlassCard className="border-rose-400/20 bg-rose-400/10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-rose-200">Backend offline</p>
                    <p className="mt-1 text-xs text-rose-200/80">
                      Start the backend and refresh — the UI will auto-reconnect.
                      {err ? <span className="ml-2">({err})</span> : null}
                    </p>
                  </div>
                  <div className="sm:max-w-[420px]">
                    <CodeSnippet value={quickBackend} />
                  </div>
                </div>
              </GlassCard>
            ) : null}

            {/* Quick Start + What judges care about */}
            <div className="grid gap-4 lg:grid-cols-2">
              <GlassCard>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Quick start</p>
                  <span className="text-[11px] text-slate-200/60">generates runs</span>
                </div>
                <div className="mt-3 space-y-2">
                  <CodeSnippet value={quickBackend} />
                  <CodeSnippet value={quickCli} />
                </div>
              </GlassCard>

              <GlassCard>
                <p className="text-sm font-semibold">What makes this judge-proof</p>
                <div className="mt-3 space-y-2 text-xs text-slate-200/70">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-bold">
                      1
                    </span>
                    <span>Evidence is first: stdout/stderr is captured and shown verbatim.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-bold">
                      2
                    </span>
                    <span>AI proposes patches — it doesn’t claim success.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-bold">
                      3
                    </span>
                    <span>Verifier reruns the command to decide pass/fail.</span>
                  </div>
                </div>
              </GlassCard>
            </div>

            {/* Proof panel */}
            <GlassCard className="p-0">
              <button
                type="button"
                onClick={() => setShowJudgeProof((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-3xl px-4 py-3 text-left"
              >
                <div>
                  <p className="text-sm font-semibold">Developer / Judge Proof</p>
                  <p className="text-xs text-slate-200/60">
                    Endpoints & artifact URLs (kept out of the main hero).
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold">
                  {showJudgeProof ? "Hide" : "Show"}
                </span>
              </button>

              {showJudgeProof ? (
                <div className="border-t border-white/10 px-4 pb-4 pt-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <CodeSnippet value={`${DISPLAY_API_BASE}/runs`} />
                    <CodeSnippet value={`${DISPLAY_API_BASE}/runs/<id>`} />
                    <CodeSnippet value={`${DISPLAY_API_BASE}/runs/<id>/logs`} />
                    <CodeSnippet value={`${DISPLAY_API_BASE}/runs/<id>/diff`} />
                    <CodeSnippet value={`${DISPLAY_API_BASE}/runs/<id>/patch`} />
                    <CodeSnippet value={`${DISPLAY_API_BASE}/runs/<id>/timeline`} />
                  </div>

                  <div className="mt-3 text-[11px] text-slate-200/60">
                    API mode:{" "}
                    <span className="font-mono">{ROOT ? `direct (${ROOT})` : "proxied (/api/v1 rewrite)"}</span>
                  </div>
                </div>
              ) : null}
            </GlassCard>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/70">
              <span className="font-semibold text-slate-100">Integrations:</span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 backdrop-blur">
                Cline · local code agent
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 backdrop-blur">
                Kestra · optional workflows
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 backdrop-blur">
                GitHub Actions · optional CI gate
              </span>
            </div>
          </section>

          {/* Right rail */}
          <aside className="space-y-4">
            <GlassCard>
              <p className="text-sm font-semibold">Backend in use</p>
              <p className="mt-1 text-xs text-slate-200/70">The UI is reading from:</p>
              <div className="mt-3">
                <CodeSnippet value={DISPLAY_API_BASE || API_BASE} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={refresh}
                  className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold transition hover:-translate-y-0.5 hover:bg-white/[0.10]"
                >
                  Refresh status
                </button>

                <Link
                  href="/dashboard"
                  className="rounded-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-400 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
                >
                  Go to dashboard →
                </Link>
              </div>
            </GlassCard>

            <GlassCard>
              <p className="text-sm font-semibold">One-sentence pitch</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-200/70">
                “InfinitySnap proposes fixes, then reruns the exact command to prove the verdict — with logs, diff,
                patch, and timeline visible.”
              </p>
            </GlassCard>
          </aside>
        </main>

        <footer className="mt-6 border-t border-white/10 pt-3 text-xs text-slate-200/60">
          InfinitySnap · Built for real failures, not mock demos.
        </footer>
      </div>
    </div>
  );
}

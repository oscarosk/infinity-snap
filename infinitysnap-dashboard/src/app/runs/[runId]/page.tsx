// src/app/runs/[runId]/page.tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import StatusBadge from "@/components/dashboard/StatusBadge";
import ConfidenceBadge from "@/components/dashboard/ConfidenceBadge";
import UnifiedViewer from "@/components/dashboard/UnifiedViewer";
import RunTimeline from "@/components/dashboard/RunTimeline";

type TabKey = "overview" | "evidence" | "replay";
type LogView = "combined" | "stdout" | "stderr";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * ✅ Browser/Codespaces safe:
 * - Default to same-origin proxy (/api/v1)
 * - NEVER default to localhost/127.0.0.1 in client code
 */
function getClientEnv() {
  const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").trim() || "/api/v1";

  // Display-only; never used for fetch when API_BASE is relative
  const BACKEND_URL =
    (process.env.NEXT_PUBLIC_BACKEND_URL || "").trim() ||
    "(proxied via Next /api/v1)";

  return { API_BASE, BACKEND_URL };
}

/* =========================================================
   InfinitySnap Theme Shell (dark + neon + glass)
   ========================================================= */

function InfinityShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      {/* subtle grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* glows */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-[-180px] h-[520px] w-[520px] rounded-full bg-fuchsia-500/20 blur-[120px]" />
        <div className="absolute -top-64 right-[-220px] h-[640px] w-[640px] rounded-full bg-cyan-400/20 blur-[140px]" />
        <div className="absolute bottom-[-240px] left-1/3 h-[560px] w-[560px] rounded-full bg-indigo-500/20 blur-[140px]" />
      </div>

      <div className="relative">{children}</div>
    </div>
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
        "rounded-3xl border border-white/10 bg-white/[0.06] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  );
}

function Pill({
  tone,
  children,
  title,
}: {
  tone: "ok" | "warn" | "bad" | "neutral" | "brand";
  children: React.ReactNode;
  title?: string;
}) {
  const cls =
    tone === "brand"
      ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-50"
      : tone === "ok"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
      : tone === "bad"
      ? "border-rose-300/20 bg-rose-300/10 text-rose-50"
      : tone === "warn"
      ? "border-amber-300/20 bg-amber-300/10 text-amber-50"
      : "border-white/10 bg-white/[0.06] text-white/80";

  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold",
        cls
      )}
    >
      {children}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
  variant,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "ghost";
}) {
  const base =
    "inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition active:scale-[0.99]";
  const cls =
    variant === "primary"
      ? "bg-white text-slate-900 hover:bg-white/90"
      : "border border-white/12 bg-white/[0.05] text-white/90 hover:bg-white/[0.08]";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        base,
        cls,
        disabled ? "cursor-not-allowed opacity-60 hover:bg-white/[0.05]" : ""
      )}
    >
      {children}
    </button>
  );
}

/**
 * ✅ FIX: active state now uses Tailwind "important" to prevent any
 * global/parent `text-white` from overriding black text on white pills.
 */
function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full px-4 py-2 text-xs font-semibold transition",
        active
          ? "!bg-white !text-slate-900 shadow-sm"
          : "border border-white/12 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]"
      )}
    >
      {children}
    </button>
  );
}

/**
 * ✅ FIX: same “important” rule for segmented buttons.
 */
function SegButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full px-3 py-1.5 text-[11px] font-semibold transition",
        active
          ? "!bg-white !text-slate-900 shadow-sm"
          : "text-white/70 hover:bg-white/[0.08]"
      )}
    >
      {children}
    </button>
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
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-white/85">
          {value}
        </pre>
        <button
          type="button"
          onClick={copy}
          className={cx(
            "shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
            "border-white/12 bg-white/[0.06] text-white/90 hover:bg-white/[0.09]"
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* --------------------- data helpers --------------------- */

function unwrapRun(r: any) {
  if (r && typeof r === "object" && "data" in r && r.data) return r.data;
  return r;
}

function normalizeStatus(run: any): string {
  return String(run?.status || run?.state || run?.verdict || "unknown");
}

function compactRepo(run: any): string {
  return run?.repoPath || run?.repo || run?.meta?.repoPath || run?.meta?.repo || "—";
}

function commandFromRun(run: any): string {
  return run?.command || run?.meta?.command || "—";
}

function confidenceFromRun(run: any): number | null {
  const c = run?.analysis?.confidence ?? run?.confidence ?? null;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (
    c &&
    typeof c === "object" &&
    typeof (c as any).score === "number" &&
    Number.isFinite((c as any).score)
  )
    return (c as any).score;
  return null;
}

function durationFromRun(run: any): string {
  const ms =
    run?.durationMs ??
    run?.metrics?.durationMs ??
    run?.timing?.durationMs ??
    run?.runResult?.durationMs ??
    null;

  if (typeof ms === "number" && Number.isFinite(ms)) {
    const sec = ms / 1000;
    return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
  }
  return run?.duration || "—";
}

function toPrettyTime(x: any): string {
  if (!x) return "—";
  if (typeof x === "number" && Number.isFinite(x)) {
    try {
      return new Date(x).toLocaleString();
    } catch {
      return String(x);
    }
  }
  const s = String(x);
  if (s.includes(":") || s.includes("-") || s.includes("T")) return s;
  return s;
}

function safeString(x: any) {
  if (x == null) return "";
  return typeof x === "string" ? x : String(x);
}

function tryExtractColdStartSeconds(timelineJson: any): number | null {
  if (!timelineJson) return null;

  const entries =
    timelineJson?.entries ||
    timelineJson?.events ||
    timelineJson?.steps ||
    timelineJson?.timeline ||
    null;

  const list = Array.isArray(entries) ? entries : null;
  if (list) {
    const cand = list.find((e: any) => {
      const id = String(e?.id || e?.name || e?.key || e?.type || "");
      return id.includes("cline.cold_start") || id.includes("cold_start");
    });
    if (cand) {
      const msg = String(cand?.message || cand?.detail || cand?.value || "");
      const m = msg.match(/(\d+(\.\d+)?)s/);
      if (m) return Number(m[1]);
      const durMs = cand?.durationMs;
      if (typeof durMs === "number" && Number.isFinite(durMs)) return durMs / 1000;
    }
  }

  try {
    const raw = JSON.stringify(timelineJson);
    const m = raw.match(/cline\.cold_start[^"]*"[^"]*?(\d+(\.\d+)?)s/);
    if (m) return Number(m[1]);
  } catch {}

  return null;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function postJson<T = any>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(text || `POST ${url} -> ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    return (text as any) as T;
  }
}

export default function RunDetailPage() {
  const params = useParams<{ runId?: string }>();
  const raw = params?.runId ? String(params.runId) : "";
  const runId = raw ? decodeURIComponent(raw) : "";

  const { API_BASE, BACKEND_URL } = useMemo(() => getClientEnv(), []);

  const [tab, setTab] = useState<TabKey>("overview");
  const [logView, setLogView] = useState<LogView>("combined");

  const [run, setRun] = useState<any>(null);
  const [logs, setLogs] = useState<any>(null);

  const [diff, setDiff] = useState<string>("");
  const [patch, setPatch] = useState<any>(null);

  const [timelineTxt, setTimelineTxt] = useState<string>("");
  const [timelineJson, setTimelineJson] = useState<any>(null);

  const [artifactsIndex, setArtifactsIndex] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixErr, setFixErr] = useState<string | null>(null);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
  };

  const refresh = async () => {
    if (!runId) return;
    setErr(null);
    setLoading(true);

    const enc = encodeURIComponent(runId);

    try {
      const runUrl = `${API_BASE}/runs/${enc}`;
      const logsUrl = `${API_BASE}/runs/${enc}/logs`;
      const diffUrl = `${API_BASE}/runs/${enc}/diff`;
      const patchUrl = `${API_BASE}/runs/${enc}/patch`;
      const timelineTxtUrl = `${API_BASE}/runs/${enc}/timeline`;
      const timelineJsonUrl = `${API_BASE}/runs/${enc}/timeline.json`;
      const artifactsUrl = `${API_BASE}/runs/${enc}/artifacts`;

      const [r0, l, d, p, tTxt, tJson, aIdx] = await Promise.all([
        fetchJson<any>(runUrl),
        fetchJson<any>(logsUrl).catch(() => null),
        fetchText(diffUrl).catch(() => ""),
        fetchJson<any>(patchUrl).catch(() => null),
        fetchText(timelineTxtUrl).catch(() => ""),
        fetchJson<any>(timelineJsonUrl).catch(() => null),
        fetchJson<any>(artifactsUrl).catch(() => null),
      ]);

      const r = unwrapRun(r0);

      setRun(r);
      setLogs(l);
      setDiff(typeof d === "string" ? d : safeString(d));
      setPatch(p ?? null);
      setTimelineTxt(typeof tTxt === "string" ? tTxt : safeString(tTxt));
      setTimelineJson(tJson);
      setArtifactsIndex(aIdx);

      setLastSync(new Date());
    } catch (e: any) {
      setErr(e?.message || "Failed to load run.");
      setLastSync(new Date());
      setRun(null);
      setLogs(null);
      setDiff("");
      setPatch(null);
      setTimelineTxt("");
      setTimelineJson(null);
      setArtifactsIndex(null);
    } finally {
      setLoading(false);
    }
  };

  const runFix = async () => {
    if (!runId) return;
    setFixErr(null);
    setFixing(true);
    try {
      const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/fix`;
      await postJson(url, { timeoutMs: 60000 });
      await refresh();
      setTab("overview");
    } catch (e: any) {
      setFixErr(e?.message || "Fix failed.");
    } finally {
      setFixing(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => refresh(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, runId]);

  const meta = useMemo(() => {
    const status = normalizeStatus(run);
    const repo = compactRepo(run);
    const command = commandFromRun(run);
    const started = toPrettyTime(run?.startedAt || run?.createdAt || run?.timestamp);
    const ended = toPrettyTime(run?.endedAt || run?.finishedAt);
    const duration = durationFromRun(run);
    const conf = confidenceFromRun(run);
    return { status, repo, command, started, ended, duration, conf };
  }, [run]);

  const refusal = useMemo(() => {
    const status = normalizeStatus(run);
    const isRefused = status.startsWith("refused_");
    const reason =
      status === "refused_not_git"
        ? "Repo is not a git repository (.git missing). InfinitySnap refuses autonomous changes without git safety."
        : status === "refused_low_confidence"
        ? "Confidence gate blocked the fix. InfinitySnap logged why and refused to apply changes."
        : isRefused
        ? `Run was refused: ${status}`
        : null;

    const logName =
      status === "refused_not_git"
        ? "policy.refusal"
        : status === "refused_low_confidence"
        ? "confidence.refusal"
        : null;

    const logHref = logName
      ? `${API_BASE}/runs/${encodeURIComponent(runId)}/logs?name=${encodeURIComponent(logName)}`
      : null;

    return { isRefused, reason, logName, logHref };
  }, [run, runId, API_BASE]);

  const { stdoutText, stderrText, combinedLogs } = useMemo(() => {
    if (typeof logs === "string") return { stdoutText: "", stderrText: "", combinedLogs: logs };

    const stdout =
      (logs as any)?.stdout ??
      (logs as any)?.out ??
      (logs as any)?.data?.stdout ??
      (logs as any)?.data?.out ??
      "";
    const stderr =
      (logs as any)?.stderr ??
      (logs as any)?.err ??
      (logs as any)?.data?.stderr ??
      (logs as any)?.data?.err ??
      "";

    const out = safeString(stdout).trim();
    const errText = safeString(stderr).trim();

    const parts: string[] = [];
    if (out) parts.push(`--- STDOUT ---\n${out}`);
    if (errText) parts.push(`--- STDERR ---\n${errText}`);

    return { stdoutText: out, stderrText: errText, combinedLogs: parts.join("\n\n").trim() };
  }, [logs]);

  const shownLogs = useMemo(() => {
    if (logView === "stdout") return stdoutText;
    if (logView === "stderr") return stderrText;
    return combinedLogs;
  }, [logView, stdoutText, stderrText, combinedLogs]);

  const coldStartSec = useMemo(() => tryExtractColdStartSeconds(timelineJson), [timelineJson]);

  const patchText = useMemo(() => {
    if (typeof patch === "string") return patch;
    if (patch == null) return "";
    try {
      return JSON.stringify(patch, null, 2);
    } catch {
      return safeString(patch);
    }
  }, [patch]);

  const hasAnyLogs = Boolean(combinedLogs || stdoutText || stderrText);
  const hasDiff = Boolean((diff || "").trim()) || Boolean(artifactsIndex?.hasDiff);
  const hasPatch = Boolean(patchText.trim()) || Boolean(artifactsIndex?.hasPatch);
  const hasTimeline = Boolean((timelineTxt || "").trim()) || Boolean(artifactsIndex?.hasTimeline);

  const lastSyncText = useMemo(() => {
    if (!lastSync) return "—";
    return lastSync.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }, [lastSync]);

  const curlBlock = useMemo(() => {
    const base = API_BASE;
    const id = encodeURIComponent(runId);

    const start = `curl -s -X POST "${base}/runs/start" \\
  -H "Content-Type: application/json" \\
  -d '{"repoPathOnHost":"./samples/infinitysnap-demo","command":"npm test"}'`;

    const fix = `curl -s -X POST "${base}/runs/${id}/fix" \\
  -H "Content-Type: application/json" \\
  -d '{"timeoutMs":60000}'`;

    const logsIndex = `curl -s "${base}/runs/${id}/logs"`;
    const diffCmd = `curl -s "${base}/runs/${id}/diff"`;
    const patchCmd = `curl -s "${base}/runs/${id}/patch"`;
    const timelineTxtCmd = `curl -s "${base}/runs/${id}/timeline"`;

    return [start, fix, logsIndex, diffCmd, patchCmd, timelineTxtCmd].join("\n\n");
  }, [runId, API_BASE]);

  const stageBadges = useMemo(() => {
    const s = normalizeStatus(run).toLowerCase();
    const refused = s.startsWith("refused_");

    const evidenceTone: "ok" | "neutral" = hasAnyLogs ? "ok" : "neutral";
    const patchTone: "ok" | "neutral" = hasPatch || hasDiff ? "ok" : "neutral";
    const verifyTone: "ok" | "warn" | "bad" | "neutral" =
      refused
        ? "warn"
        : ["verified", "success", "passed", "pass", "fixed", "ok"].includes(s)
        ? "ok"
        : ["fail", "failed", "error"].includes(s)
        ? "bad"
        : "neutral";

    return { evidenceTone, patchTone, verifyTone, refused };
  }, [run, hasAnyLogs, hasPatch, hasDiff]);

  const canFix = useMemo(() => {
    const s = normalizeStatus(run).toLowerCase();
    if (!run) return false;
    if (s.startsWith("refused_")) return false;
    if (fixing) return false;
    return true;
  }, [run, fixing]);

  return (
    <InfinityShell>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* HEADER */}
        <header className="sticky top-0 z-20 mb-6">
          <GlassCard className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/dashboard"
                    className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-white/90 hover:bg-white/[0.08]"
                  >
                    ← Dashboard
                  </Link>

                  <Pill tone="brand" title="InfinitySnap Run ID">
                    ∞ <span className="font-mono">{runId || "—"}</span>
                  </Pill>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={meta.status} />
                    <Pill tone="neutral" title="This is the verifier’s verdict, not an AI claim.">
                      ✓ verification verdict
                    </Pill>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ConfidenceBadge confidence={meta.conf ?? null} />
                    <Pill tone="neutral" title="AI signal can be wrong; gates can refuse.">
                      ✦ AI signal
                    </Pill>
                  </div>

                  <Pill tone={err ? "bad" : loading ? "warn" : "ok"}>
                    {err ? "offline" : loading ? "loading" : "live"} · sync {lastSyncText}
                  </Pill>

                  {typeof coldStartSec === "number" ? (
                    <Pill tone="neutral" title="Measured from timeline.json">
                      ⏱ cold-start {coldStartSec.toFixed(2)}s
                    </Pill>
                  ) : (
                    <Pill tone="neutral">⏱ cold-start —</Pill>
                  )}
                </div>

                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <Pill tone={stageBadges.evidenceTone}>1) evidence {hasAnyLogs ? "✓" : "—"}</Pill>
                    <span className="text-white/30">→</span>
                    <Pill tone={stageBadges.patchTone}>2) patch {hasPatch || hasDiff ? "✓" : "—"}</Pill>
                    <span className="text-white/30">→</span>
                    <Pill tone={stageBadges.verifyTone}>3) verify</Pill>

                    <span className="ml-2 text-white/60">
                      Repo: <span className="font-mono text-white/85">{meta.repo}</span>
                    </span>
                  </div>

                  <p className="mt-2 text-[12px] text-white/70">
                    InfinitySnap doesn’t “declare success” — it proposes a patch, then{" "}
                    <span className="font-semibold text-white">reruns the command</span> to decide pass/fail.
                  </p>
                </div>

                <Divider />

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
                    Overview
                  </TabButton>
                  <TabButton active={tab === "evidence"} onClick={() => setTab("evidence")}>
                    Evidence
                  </TabButton>
                  <TabButton active={tab === "replay"} onClick={() => setTab("replay")}>
                    Replay
                  </TabButton>

                  {tab === "evidence" ? (
                    <div className="ml-1 flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.05] p-1">
                        <SegButton active={logView === "combined"} onClick={() => setLogView("combined")}>
                          Combined
                        </SegButton>
                        <SegButton active={logView === "stdout"} onClick={() => setLogView("stdout")}>
                          STDOUT
                        </SegButton>
                        <SegButton active={logView === "stderr"} onClick={() => setLogView("stderr")}>
                          STDERR
                        </SegButton>
                      </div>

                      <label className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-white/85">
                        <input
                          type="checkbox"
                          className="accent-white"
                          checked={autoRefresh}
                          onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        Auto (8s)
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* ACTIONS */}
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton onClick={() => copyText(runId)} disabled={!runId} title="Copy runId">
                  Copy runId
                </ActionButton>

                <ActionButton onClick={refresh} title="Re-fetch all artifacts">
                  Refresh
                </ActionButton>

                <ActionButton
                  variant="primary"
                  onClick={runFix}
                  disabled={!canFix}
                  title="Run /fix pipeline for this run"
                >
                  {fixing ? "Fixing…" : "Run fix"}
                </ActionButton>

                <ActionButton onClick={() => setInspectorOpen(true)} title="Artifacts & endpoints">
                  Inspector
                </ActionButton>
              </div>
            </div>

            {/* WARN / ERROR BANNERS */}
            {refusal.isRefused && refusal.reason ? (
              <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3">
                <div className="text-sm font-semibold text-amber-50">Autonomy refused (by design)</div>
                <div className="mt-1 text-xs text-amber-50/80">{refusal.reason}</div>
                {refusal.logHref ? (
                  <div className="mt-2">
                    <a
                      href={refusal.logHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-full border border-amber-300/20 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-white/[0.09]"
                    >
                      Open refusal log → {refusal.logName}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            {fixErr ? (
              <div className="mt-3 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3">
                <div className="text-sm font-semibold text-rose-50">Fix failed</div>
                <div className="mt-1 text-xs text-rose-50/80">{fixErr}</div>
              </div>
            ) : null}

            {err ? (
              <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3">
                <div className="text-sm font-semibold text-rose-50">Backend unreachable</div>
                <div className="mt-1 text-xs text-rose-50/80">{err}</div>
                <div className="mt-2 text-xs text-rose-50/80">
                  Backend: <span className="font-mono">{BACKEND_URL}</span>
                </div>
              </div>
            ) : null}
          </GlassCard>
        </header>

        {/* LOADING / EMPTY */}
        {!err && !run && loading ? (
          <GlassCard className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white">Loading run…</div>
                <div className="mt-1 text-xs text-white/65">Fetching artifacts, logs, diff, patch, timeline.</div>
              </div>
              <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
            </div>
          </GlassCard>
        ) : null}

        {/* CONTENT */}
        {!err && run ? (
          <div className="space-y-6">
            {tab === "overview" ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
                <section className="space-y-4">
                  <GlassCard className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">Run facts</div>
                        <div className="mt-1 text-xs text-white/65">The exact inputs the verifier used.</div>
                      </div>
                      <ActionButton
                        onClick={() => copyText(meta.command)}
                        disabled={!meta.command || meta.command === "—"}
                        title="Copy command"
                      >
                        Copy command
                      </ActionButton>
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 font-mono text-[12px] text-white/85">
                      {meta.command || "—"}
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-3 text-[11px]">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                        <div className="font-semibold text-white/85">Started</div>
                        <div className="mt-1 font-mono text-white/80">{meta.started}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                        <div className="font-semibold text-white/85">Ended</div>
                        <div className="mt-1 font-mono text-white/80">{meta.ended}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                        <div className="font-semibold text-white/85">Duration</div>
                        <div className="mt-1 font-mono text-white/80">{meta.duration}</div>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-5">
                    <div className="text-sm font-semibold text-white">Narrative timeline</div>
                    <div className="mt-1 text-xs text-white/65">
                      What you narrate to judges (high-level, human-readable).
                    </div>
                    <div className="mt-4">
                      <RunTimeline run={run} />
                    </div>
                  </GlassCard>
                </section>

                <aside className="space-y-4">
                  <GlassCard className="p-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/60">
                      How to describe InfinitySnap
                    </div>
                    <ul className="mt-3 space-y-2 text-xs text-white/80">
                      <li>
                        <span className="font-semibold text-white">Evidence-first:</span> show logs/diff/patch as receipts.
                      </li>
                      <li>
                        <span className="font-semibold text-white">Gated autonomy:</span> refuses on low confidence / no git.
                      </li>
                      <li>
                        <span className="font-semibold text-white">Verifier decides:</span> rerun verdict prevents bluffing.
                      </li>
                    </ul>
                  </GlassCard>

                  <GlassCard className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">Artifacts snapshot</div>
                        <div className="mt-1 text-xs text-white/65">
                          Summary from{" "}
                          <span className="font-mono">{artifactsIndex ? "/artifacts" : "(not available)"}</span>
                        </div>
                      </div>
                      <ActionButton onClick={() => setInspectorOpen(true)} title="Open inspector">
                        Open
                      </ActionButton>
                    </div>

                    <pre className="mt-4 max-h-[280px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/85">
                      <code className="whitespace-pre">
                        {JSON.stringify(
                          artifactsIndex || { note: "No artifacts index (endpoint missing or empty)" },
                          null,
                          2
                        )}
                      </code>
                    </pre>
                  </GlassCard>

                  <GlassCard className="p-5">
                    <div className="text-sm font-semibold text-white">Cold-start latency</div>
                    <div className="mt-1 text-xs text-white/65">
                      Shown explicitly so latency looks intentional (measured, not hidden).
                    </div>
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-sm font-semibold text-white/90">
                      {typeof coldStartSec === "number" ? `${coldStartSec.toFixed(2)}s` : "—"}
                    </div>
                  </GlassCard>
                </aside>
              </div>
            ) : null}

            {tab === "evidence" ? (
              <div className="space-y-4">
                <GlassCard className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">Evidence console</div>
                      <div className="mt-1 text-xs text-white/65">
                        Logs → Diff/Patch → Verdict. “No vibes, just receipts.”
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={hasAnyLogs ? "ok" : "neutral"}>logs {hasAnyLogs ? "✓" : "—"}</Pill>
                      <Pill tone={hasDiff ? "ok" : "neutral"}>diff {hasDiff ? "✓" : "—"}</Pill>
                      <Pill tone={hasPatch ? "ok" : "neutral"}>patch {hasPatch ? "✓" : "—"}</Pill>
                    </div>
                  </div>
                </GlassCard>

                <UnifiedViewer
                  logsCombined={shownLogs || ""}
                  diff={diff || ""}
                  patch={patchText || ""}
                  rawLogsHref={`${API_BASE}/runs/${encodeURIComponent(runId)}/logs`}
                  rawDiffHref={`${API_BASE}/runs/${encodeURIComponent(runId)}/diff`}
                  rawPatchHref={`${API_BASE}/runs/${encodeURIComponent(runId)}/patch`}
                  defaultTab="logs"
                  maxHeightClass="max-h-[720px]"
                />
              </div>
            ) : null}

            {tab === "replay" ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
                <section className="space-y-4">
                  <GlassCard className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-white">Replay proof (timeline.txt)</div>
                        <div className="mt-1 text-xs text-white/65">Raw step-by-step proof.</div>
                      </div>
                      <a
                        href={`${API_BASE}/runs/${encodeURIComponent(runId)}/timeline`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-white/90 hover:bg-white/[0.08]"
                      >
                        Open raw
                      </a>
                    </div>

                    <pre className="mt-4 max-h-[640px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3 text-[12px] text-white/85">
                      <code className="whitespace-pre">{timelineTxt || ""}</code>
                    </pre>
                  </GlassCard>
                </section>

                <aside className="space-y-4">
                  <GlassCard className="p-5">
                    <div className="text-sm font-semibold text-white">Structured replay (timeline.json)</div>
                    <div className="mt-1 text-xs text-white/65">Machine-readable proof.</div>
                    <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/85">
                      <code className="whitespace-pre">
                        {timelineJson ? JSON.stringify(timelineJson, null, 2) : ""}
                      </code>
                    </pre>
                  </GlassCard>

                  <GlassCard className="p-5">
                    <div className="text-sm font-semibold text-white">Quick story for judges</div>
                    <div className="mt-1 text-xs text-white/65">
                      Say this while scrolling: evidence → patch → verify. Cold-start shown as measured latency.
                    </div>
                    <div className="mt-4 space-y-2 text-xs text-white/80">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                        <span className="font-semibold text-white">Evidence</span>: open logs, show failing lines.
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                        <span className="font-semibold text-white">Patch</span>: show diff + patch JSON.
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                        <span className="font-semibold text-white">Verify</span>: rerun decides pass/fail.
                      </div>
                    </div>
                  </GlassCard>
                </aside>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* INSPECTOR */}
        {inspectorOpen ? (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/50" onClick={() => setInspectorOpen(false)} />
            <div className="absolute right-0 top-0 h-full w-full max-w-[600px] overflow-auto border-l border-white/10 bg-[#0A0E18]/90 p-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Inspector</div>
                  <div className="mt-1 text-xs text-white/65">Raw endpoints + demo cURLs.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/[0.08]"
                >
                  Close
                </button>
              </div>

              <Divider />

              <div className="mt-4 space-y-4">
                <GlassCard className="p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Backend</div>
                  <div className="mt-2 rounded-2xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/85">
                    <div>
                      <span className="text-white/60">API_BASE:</span>{" "}
                      <span className="font-mono">{API_BASE}</span>
                    </div>
                    <div className="mt-1">
                      <span className="text-white/60">BACKEND_URL:</span>{" "}
                      <span className="font-mono">{BACKEND_URL}</span>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Demo cURL</div>
                  <div className="mt-3 space-y-2">
                    <ActionButton onClick={() => copyText(curlBlock)} title="Copy all commands" variant="primary">
                      Copy all cURLs
                    </ActionButton>
                    <CodeSnippet value={curlBlock} />
                  </div>
                </GlassCard>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </InfinityShell>
  );
}

"use client";

import React, { useMemo } from "react";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { Badge, GlassCard } from "@/components/dashboard/ui";

type RunLike = any;

type StepTone = "neutral" | "ok" | "warn" | "bad";
type Step = {
  key: string;
  title: string;
  desc?: string;
  tone: StepTone;
  ts?: string;
  meta?: string;
};

function prettyTime(x: any) {
  if (!x) return "";
  const s = String(x);
  return s.includes("T") || s.includes(":") || s.includes("-") ? s : s;
}

function normalizeStatus(run: RunLike): string {
  return String(run?.status || run?.state || run?.verdict || "unknown");
}

function bucketFromStatus(statusRaw: string) {
  const s = String(statusRaw || "").toLowerCase();
  if (s.startsWith("refused_")) return "skipped";
  if (["verified", "fixed", "success", "passed", "pass", "ok"].includes(s)) return "fixed";
  if (["failed", "fail", "error"].includes(s)) return "failed";
  if (["running", "pending", "queued", "analyzing", "patching", "verifying", "executing", "starting"].includes(s))
    return "running";
  if (["skipped", "skip"].includes(s)) return "skipped";
  return "unknown";
}

function toneForBucket(b: string): StepTone {
  if (b === "fixed") return "ok";
  if (b === "failed") return "bad";
  if (b === "running") return "warn";
  return "neutral";
}

function iconForTone(t: StepTone) {
  if (t === "ok") return "✅";
  if (t === "bad") return "❌";
  if (t === "warn") return "⏳";
  return "•";
}

function extractSteps(run: RunLike): Step[] | null {
  const steps = run?.steps || run?.timeline || run?.events || run?.logSteps || run?.meta?.steps || null;
  if (!steps) return null;

  if (Array.isArray(steps)) {
    return steps
      .map((s: any, idx: number) => {
        const title = s?.title || s?.name || s?.step || s?.phase || `Step ${idx + 1}`;
        const status = String(s?.status || s?.state || s?.verdict || "");
        const tone = status ? toneForBucket(bucketFromStatus(status)) : "neutral";
        const ts = prettyTime(s?.timestamp || s?.ts || s?.at || "");
        const desc = s?.message || s?.desc || s?.detail || "";
        const meta = s?.meta?.tool || s?.tool || s?.meta?.provider || s?.provider || "";
        return {
          key: String(s?.id || `${idx}-${title}`),
          title: String(title),
          desc: desc ? String(desc) : undefined,
          tone,
          ts: ts || undefined,
          meta: meta ? String(meta) : undefined,
        };
      })
      .filter(Boolean);
  }

  return null;
}

function synthesizeSteps(run: RunLike): Step[] {
  const status = normalizeStatus(run);
  const bucket = bucketFromStatus(status);
  const tone = toneForBucket(bucket);

  const started = prettyTime(run?.startedAt || run?.createdAt || run?.timestamp || "");
  const ended = prettyTime(run?.endedAt || run?.finishedAt || "");

  const s = status.toLowerCase();
  const analyzeTone: StepTone = s.includes("analyz") ? "warn" : started ? "ok" : "neutral";
  const fixTone: StepTone = s.includes("patch") || s.includes("fix") ? "warn" : bucket === "fixed" ? "ok" : "neutral";
  const verifyTone: StepTone =
    s.includes("verif") ? "warn" : bucket === "fixed" ? "ok" : bucket === "failed" ? "bad" : "neutral";

  return [
    { key: "snap", title: "Snap", desc: "Sandbox executed the command and captured output.", tone: started ? "ok" : "neutral", ts: started || undefined, meta: "sandbox" },
    { key: "analyze", title: "Analyze", desc: "Extracted error signals and planned fix candidates.", tone: analyzeTone, meta: "analyzer" },
    { key: "fix", title: "Fix", desc: "Generated patch/diff artifacts when appropriate.", tone: fixTone, meta: "patch/diff" },
    { key: "verify", title: "Verify", desc: bucket === "fixed" ? "Re-ran to confirm stability." : bucket === "failed" ? "Verification failed (see logs)." : "Verification stage (if enabled).", tone: verifyTone, ts: ended || undefined, meta: status ? `status: ${status}` : undefined },
    { key: "result", title: "Result", desc: "Final verdict for this run.", tone, meta: status || "unknown" },
  ];
}

function toneToBadge(t: StepTone) {
  if (t === "ok") return "ok";
  if (t === "warn") return "warn";
  if (t === "bad") return "bad";
  return "neutral";
}

export default function RunTimeline({
  run,
  title = "Run timeline",
  subtitle = "Snap → Analyze → Fix → Verify — quick narrative for judges.",
}: {
  run: RunLike;
  title?: string;
  subtitle?: string;
}) {
  const status = normalizeStatus(run);

  const steps = useMemo(() => {
    const extracted = extractSteps(run);
    if (extracted && extracted.length > 0) return extracted;
    return synthesizeSteps(run);
  }, [run]);

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
          <div className="text-xs text-slate-600 dark:text-slate-300">{subtitle}</div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <Badge tone="neutral" title="UI-only summary. If backend adds real steps later, UI renders them.">
            transparent
          </Badge>
        </div>
      </div>

      <div className="p-4">
        <ol className="space-y-3">
          {steps.map((st, idx) => {
            const icon = iconForTone(st.tone);

            const row =
              st.tone === "ok"
                ? "border-emerald-500/15 bg-emerald-500/10"
                : st.tone === "bad"
                ? "border-rose-500/15 bg-rose-500/10"
                : st.tone === "warn"
                ? "border-amber-500/15 bg-amber-500/10"
                : "border-white/15 bg-white/40 dark:border-white/10 dark:bg-white/5";

            return (
              <li key={st.key}>
                <div className={`rounded-3xl border p-3 backdrop-blur ${row}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm">{icon}</div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {idx + 1}. {st.title}
                        </div>
                      </div>

                      {st.desc ? (
                        <div className="mt-1 text-xs text-slate-700 dark:text-slate-200">{st.desc}</div>
                      ) : null}

                      {(st.ts || st.meta) ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {st.ts ? <Badge tone="neutral">ts: {st.ts}</Badge> : null}
                          {st.meta ? <Badge tone="neutral">{st.meta}</Badge> : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0">
                      <Badge tone={toneToBadge(st.tone)}>{st.tone}</Badge>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 text-[11px] text-slate-600 dark:text-slate-300">
          If backend stores structured steps later (e.g. <span className="font-mono">run.steps</span>), this component automatically renders them.
        </div>
      </div>
    </GlassCard>
  );
}

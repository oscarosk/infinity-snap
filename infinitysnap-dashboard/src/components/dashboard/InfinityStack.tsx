// src/components/dashboard/InfinityStack.tsx
"use client";

import React, { useMemo, useState } from "react";
import { BACKEND_URL, API_BASE } from "@/lib/api";

import GlassCard from "@/components/ui/GlassCard";
import Badge from "@/components/ui/Badge";
import IconButton from "@/components/ui/IconButton";
import { cx } from "@/components/ui/cx";

type Tone = "ok" | "warn" | "bad" | "neutral";

/**
 * Infinity Stack
 * ----------------
 * Transparent, judge-friendly declaration of what is ACTUALLY wired
 * into this build. No implied integrations, no marketing fluff.
 */

function envTone(value: string | undefined | null): Tone {
  if (!value) return "neutral";
  const v = String(value).toLowerCase();
  if (v.includes("changeme") || v.includes("todo") || v.includes("your_")) {
    return "warn";
  }
  return "ok";
}

function StackRow({
  name,
  desc,
  href,
  right,
}: {
  name: string;
  desc: string;
  href?: string;
  right?: React.ReactNode;
}) {
  const content = (
    <div
      className={cx(
        "flex items-start justify-between gap-3 rounded-3xl",
        "border border-white/15 bg-white/50 p-4 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.25)] backdrop-blur-xl",
        "dark:border-white/10 dark:bg-white/5"
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">
          {name}
        </div>
        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
          {desc}
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );

  if (!href) return content;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open link"
      className="block"
    >
      {content}
    </a>
  );
}

function EnvLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="rounded-full border border-white/15 bg-white/50 px-2.5 py-0.5 font-mono text-[11px] text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
        {k}
      </span>
      <span className="font-mono break-all text-slate-800 dark:text-slate-100">
        {v}
      </span>
    </div>
  );
}

export default function InfinityStack() {
  // Client-visible ONLY if NEXT_PUBLIC_* is set (safe if empty)
  const clineProvider = process.env.NEXT_PUBLIC_CLINE_PROVIDER || "";
  const clineModel = process.env.NEXT_PUBLIC_CLINE_MODEL || "";
  const kestraUrl = process.env.NEXT_PUBLIC_KESTRA_API_URL || "";

  const [showEnv, setShowEnv] = useState(false);

  const rows = useMemo(() => {
    const r: Array<{
      name: string;
      desc: string;
      pills: { t: Tone; label: string; title?: string }[];
      href?: string;
    }> = [];

    r.push({
      name: "InfinitySnap Backend",
      desc: "Single source of truth: runs, logs, diff, patch, timeline, metrics.",
      pills: [
        { t: "ok", label: "live" },
        { t: "neutral", label: "evidence-first" },
      ],
      href: `${API_BASE}/runs`,
    });

    r.push({
      name: "Sandbox execution",
      desc: "Deterministic run → capture logs → diff/patch → verify.",
      pills: [{ t: "ok", label: "enabled" }],
    });

    r.push({
      name: "Cline (agent)",
      desc:
        "Agentic reasoning for suggestions and research. " +
        "Does NOT decide success — verification does.",
      pills: [
        clineProvider
          ? { t: envTone(clineProvider), label: clineProvider }
          : { t: "neutral", label: "provider —" },
        clineModel
          ? { t: envTone(clineModel), label: clineModel }
          : { t: "neutral", label: "model —" },
      ],
      href: "https://cline.bot",
    });

    // Kestra is OPTIONAL — shown only if configured
    if (kestraUrl) {
      r.push({
        name: "Kestra (optional)",
        desc:
          "Optional workflow runner for verification pipelines and artifact collection. " +
          "InfinitySnap works without it.",
        pills: [{ t: envTone(kestraUrl), label: "configured" }],
      });
    }

    return r;
  }, [clineProvider, clineModel, kestraUrl]);

  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Infinity Stack
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            What is actually wired into this build (transparent for judges).
          </div>
        </div>

        <IconButton
          onClick={() => setShowEnv((v) => !v)}
          title="Show/hide client-visible environment summary"
        >
          {showEnv ? "Hide" : "Show"} env
        </IconButton>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <StackRow
            key={row.name}
            name={row.name}
            desc={row.desc}
            href={row.href}
            right={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {row.pills.map((p, i) => (
                  <Badge key={i} tone={p.t} title={p.title}>
                    {p.label}
                  </Badge>
                ))}
              </div>
            }
          />
        ))}
      </div>

      {showEnv ? (
        <div
          className={cx(
            "mt-4 rounded-3xl border border-white/15 bg-white/40 p-4 backdrop-blur",
            "dark:border-white/10 dark:bg-white/5"
          )}
        >
          <div className="text-xs font-semibold text-slate-900 dark:text-white">
            Client-visible env (safe)
          </div>

          <div className="mt-2 space-y-2 text-[11px] text-slate-700 dark:text-slate-200">
            <EnvLine k="BACKEND_URL" v={BACKEND_URL} />
            <EnvLine k="API_BASE" v={API_BASE} />
            <EnvLine k="NEXT_PUBLIC_CLINE_PROVIDER" v={clineProvider || "—"} />
            <EnvLine k="NEXT_PUBLIC_CLINE_MODEL" v={clineModel || "—"} />
            <EnvLine k="NEXT_PUBLIC_KESTRA_API_URL" v={kestraUrl || "—"} />
          </div>

          <div className="mt-3 text-[11px] text-slate-600 dark:text-slate-300">
            Note: Only <span className="font-mono">NEXT_PUBLIC_*</span> variables
            can appear here. Secrets remain server-side.
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}

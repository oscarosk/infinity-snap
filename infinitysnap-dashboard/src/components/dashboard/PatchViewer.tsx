// src/components/dashboard/PatchViewer.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";

import GlassCard from "@/components/ui/GlassCard";
import Badge from "@/components/ui/Badge";
import IconButton from "@/components/ui/IconButton";
import { cx } from "@/components/ui/cx";
import HighlightedText from "@/components/ui/HighlightedText";
import { useSearchNavigator } from "@/hooks/useSearchNavigator";

type Tone = "neutral" | "warn" | "bad" | "ok";

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function splitLines(text: string) {
  return (text || "").replace(/\r\n/g, "\n").split("\n");
}

function isHeaderLine(line: string) {
  return (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("@@")
  );
}

function lineKind(line: string): "add" | "del" | "hdr" | "ctx" {
  if (isHeaderLine(line)) return "hdr";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "ctx";
}

function looksLikeUnifiedDiff(text: string) {
  const t = (text || "").slice(0, 2000);
  return t.includes("diff --git") || t.includes("@@") || t.includes("--- ") || t.includes("+++ ");
}

export default function PatchViewer({
  patch,
  title = "Patch",
  subtitle = "Patch content produced by InfinitySnap (copy/apply-friendly).",
  filename = "run.patch",
  maxHeightClass = "max-h-[620px]",
  defaultQuery = "",
  rawHref,
}: {
  patch: string;
  title?: string;
  subtitle?: string;
  filename?: string;
  maxHeightClass?: string;
  defaultQuery?: string;
  rawHref?: string;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [showApply, setShowApply] = useState(true);

  const lines = useMemo(() => splitLines(patch), [patch]);
  const isDiff = useMemo(() => looksLikeUnifiedDiff(patch), [patch]);

  const counts = useMemo(() => {
    let adds = 0;
    let dels = 0;
    let files = 0;

    for (const l of lines) {
      if (l.startsWith("diff --git")) files++;
      const k = lineKind(l);
      if (k === "add") adds++;
      if (k === "del") dels++;
    }
    return { adds, dels, files };
  }, [lines]);

  const { query, setQuery, queryRegex, matchIndex, matchLineIndexes, activeMatchLine, goNextMatch, goPrevMatch } =
    useSearchNavigator({
      lines,
      defaultQuery,
      containerRef: bodyRef,
      ringClass: "ring-2 ring-amber-400/70",
    });

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(patch || "");
    } catch {}
  };

  const tone: Tone = !patch?.trim() ? "neutral" : isDiff ? "ok" : "warn";

  const applyGit = `# Save patch and apply with git
cat > ${filename} <<'PATCH'
${patch || ""}
PATCH

git apply ${filename}`;

  const applyPatch = `# Save patch and apply with GNU patch
cat > ${filename} <<'PATCH'
${patch || ""}
PATCH

patch -p1 < ${filename}`;

  const hasPatch = Boolean(patch && patch.trim().length > 0);

  return (
    <GlassCard>
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{subtitle}</div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={tone} title="Format hint">
                {isDiff ? "unified diff" : "text patch"}
              </Badge>
              <Badge tone="neutral">{lines.length.toLocaleString()} lines</Badge>

              {isDiff ? (
                <Badge tone="neutral">
                  {counts.files} files · +{counts.adds} / -{counts.dels}
                </Badge>
              ) : null}

              {queryRegex ? <Badge tone="neutral">{matchLineIndexes.length} matches</Badge> : <Badge tone="neutral">Search to jump</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {rawHref ? (
              <a
                href={rawHref}
                target="_blank"
                rel="noreferrer"
                className={cx(
                  "rounded-full px-4 py-2 text-xs font-semibold transition shadow-sm",
                  "border border-white/15 bg-white/50 text-slate-900 backdrop-blur hover:bg-white/70",
                  "dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                )}
              >
                Open raw
              </a>
            ) : null}

            <IconButton onClick={copyAll} title="Copy full patch">
              Copy
            </IconButton>

            <IconButton onClick={() => downloadText(filename, patch || "")} title="Download patch file">
              Download
            </IconButton>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/40 p-1 backdrop-blur dark:border-white/10 dark:bg-white/5">
              <button
                type="button"
                onClick={goPrevMatch}
                disabled={matchLineIndexes.length === 0}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10"
                title="Previous match"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={goNextMatch}
                disabled={matchLineIndexes.length === 0}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10"
                title="Next match"
              >
                Next
              </button>

              <span className="px-2 text-[11px] text-slate-600 dark:text-slate-300">
                {matchLineIndexes.length > 0
                  ? `${Math.min(matchIndex + 1, matchLineIndexes.length)} / ${matchLineIndexes.length}`
                  : "—"}
              </span>
            </div>

            <IconButton onClick={() => setShowApply((v) => !v)} title="Show copy-ready apply commands">
              {showApply ? "Hide apply" : "Show apply"}
            </IconButton>

            {activeMatchLine != null ? (
              <Badge tone="neutral" title="Current match line">
                line {(activeMatchLine + 1).toLocaleString()}
              </Badge>
            ) : null}
          </div>

          <div className="w-full lg:w-[460px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search patch (e.g., "package.json", "import", "fix")…'
              className={cx(
                "w-full rounded-2xl border px-3 py-2 text-sm outline-none transition",
                "border-white/15 bg-white/50 text-slate-900 placeholder:text-slate-400 backdrop-blur focus:border-white/30",
                "dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-white/20"
              )}
            />
          </div>
        </div>
      </div>

      {/* Apply snippet */}
      {showApply ? (
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">Apply locally</div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              Copy-ready commands for demos. Prefer <span className="font-mono">git apply</span>.
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <ApplyBox title="git apply (recommended)" value={applyGit} />
            <ApplyBox title="patch -p1 (fallback)" value={applyPatch} />
          </div>
        </div>
      ) : null}

      {/* Patch body (✅ stronger surface) */}
      <div className="p-4">
        <div
          ref={bodyRef}
          className={cx(
            "overflow-auto rounded-2xl border border-white/10",
            "bg-black/30 backdrop-blur",
            maxHeightClass
          )}
        >
          <div className="min-w-[760px]">
            {!hasPatch ? (
              <div className="px-4 py-12 text-center text-xs text-slate-600 dark:text-slate-300">No patch content.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {lines.map((line, i) => {
                  const k = isDiff ? lineKind(line) : "ctx";
                  const isMatch = queryRegex ? queryRegex.test(line) : false;
                  const isActiveMatch = activeMatchLine != null && activeMatchLine === i;

                  const rowBg = isActiveMatch
                    ? "bg-amber-500/15"
                    : k === "hdr"
                    ? "bg-white/[0.06]"
                    : k === "add"
                    ? "bg-emerald-500/12"
                    : k === "del"
                    ? "bg-rose-500/12"
                    : i % 2 === 0
                    ? "bg-white/[0.02]"
                    : "bg-white/[0.01]";

                  const textCls =
                    k === "hdr"
                      ? "text-white font-semibold"
                      : k === "add"
                      ? "text-emerald-100"
                      : k === "del"
                      ? "text-rose-100"
                      : "text-white/90";

                  return (
                    <div key={i} data-line={i} className={cx("grid grid-cols-[74px_1fr] gap-3 px-4 py-1", rowBg)}>
                      <div className="select-none text-right text-[11px] text-white/45">
                        {String(i + 1).padStart(5, " ")}
                      </div>

                      <div className={cx("font-mono text-[11px] leading-5 whitespace-pre-wrap break-words", textCls)}>
                        {queryRegex && isMatch ? <HighlightedText line={line} query={query} /> : line}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300">
        <div>Tip: search filenames/keywords to jump quickly.</div>
        <div className="font-mono opacity-80">{filename}</div>
      </div>
    </GlassCard>
  );
}

function ApplyBox({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {}
  };

  return (
    <div className="rounded-3xl border border-white/15 bg-white/50 p-3 backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-900 dark:text-white">{title}</div>
        <button
          type="button"
          onClick={copy}
          className={cx(
            "rounded-full px-3 py-1.5 text-[11px] font-semibold transition",
            "border border-white/15 bg-white/60 text-slate-900 hover:bg-white/80",
            "dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="mt-2 max-h-[220px] overflow-auto rounded-2xl border border-white/10 bg-black/[0.15] p-3 text-[11px] text-slate-900 dark:bg-white/[0.03] dark:text-slate-100">
        <code className="whitespace-pre">{value}</code>
      </pre>
    </div>
  );
}

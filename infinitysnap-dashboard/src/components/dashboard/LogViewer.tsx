"use client";

import React, { useMemo, useRef } from "react";

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

function isErrorLine(line: string) {
  const s = line.toLowerCase();
  return (
    s.includes("error") ||
    s.includes("exception") ||
    s.includes("traceback") ||
    s.includes("failed") ||
    s.includes("fatal") ||
    s.includes("panic") ||
    s.includes("segfault") ||
    s.includes("assert") ||
    s.includes("unhandled") ||
    s.includes("cannot") ||
    s.includes("refused") ||
    s.includes("timeout")
  );
}

export default function LogViewer({
  text,
  title = "Logs",
  subtitle,
  filename = "run.log",
  maxHeightClass = "max-h-[620px]",
  defaultQuery = "",
}: {
  text: string;
  title?: string;
  subtitle?: string;
  filename?: string;
  maxHeightClass?: string;
  defaultQuery?: string;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => splitLines(text), [text]);

  const errorLineIndexes = useMemo(() => {
    const idx: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (isErrorLine(lines[i])) idx.push(i);
    }
    return idx;
  }, [lines]);

  const {
    query,
    setQuery,
    queryRegex,
    matchIndex,
    matchLineIndexes,
    activeMatchLine,
    goNextMatch,
    goPrevMatch,
    scrollToLine,
  } = useSearchNavigator({
    lines,
    defaultQuery,
    containerRef: bodyRef,
    ringClass: "ring-2 ring-amber-400/70",
  });

  const jumpToFirstError = () => {
    if (errorLineIndexes.length === 0) return;
    scrollToLine(errorLineIndexes[0]);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text || "");
    } catch {}
  };

  const toneForErrors: Tone =
    errorLineIndexes.length === 0 ? "ok" : errorLineIndexes.length < 5 ? "warn" : "bad";

  return (
    <GlassCard>
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {title}
            </div>
            {subtitle ? (
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {subtitle}
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="neutral" title="Number of lines">
                {lines.length.toLocaleString()} lines
              </Badge>
              <Badge
                tone={toneForErrors}
                title="Heuristic scan for error/fail/exception keywords"
              >
                {errorLineIndexes.length} error-ish
              </Badge>
              {queryRegex ? (
                <Badge tone="neutral" title="Lines matching your search query">
                  {matchLineIndexes.length} matches
                </Badge>
              ) : (
                <Badge tone="neutral">Search to jump</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconButton onClick={copyAll} title="Copy full logs">
              Copy
            </IconButton>
            <IconButton
              onClick={() => downloadText(filename, text || "")}
              title="Download log file"
            >
              Download
            </IconButton>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton
              onClick={jumpToFirstError}
              disabled={errorLineIndexes.length === 0}
              title="Jump to the first error-ish line"
            >
              Jump to first error
            </IconButton>

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
              placeholder='Search logs (e.g., "TypeError", "FAILED", "ECONNREFUSED")…'
              className={cx(
                "w-full rounded-2xl border px-3 py-2 text-sm outline-none transition",
                "border-white/15 bg-white/50 text-slate-900 placeholder:text-slate-400 backdrop-blur focus:border-white/30",
                "dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-white/20"
              )}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} className={cx("overflow-auto", maxHeightClass)}>
        <div className="min-w-[760px]">
          {lines.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-slate-600 dark:text-slate-300">
              No log content.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {lines.map((line, i) => {
                const errish = isErrorLine(line);
                const isMatch = queryRegex ? queryRegex.test(line) : false;
                const isActiveMatch = activeMatchLine != null && activeMatchLine === i;

                const rowBg = isActiveMatch
                  ? "bg-amber-500/10"
                  : errish
                  ? "bg-rose-500/10"
                  : i % 2 === 0
                  ? "bg-transparent"
                  : "bg-black/[0.02] dark:bg-white/[0.02]";

                return (
                  <div
                    key={i}
                    data-line={i}
                    className={cx("grid grid-cols-[74px_1fr] gap-3 px-4 py-1", rowBg)}
                  >
                    <div className="select-none text-right text-[11px] text-slate-500 dark:text-slate-400">
                      {String(i + 1).padStart(5, " ")}
                    </div>

                    <div className="font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">
                      {queryRegex && isMatch ? (
                        <HighlightedText line={line} query={query} />
                      ) : (
                        line
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300">
        <div>Tip: search + jump makes huge logs demo-friendly.</div>
        <div className="font-mono opacity-80">{filename}</div>
      </div>
    </GlassCard>
  );
}

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

export default function DiffViewer({
  diff,
  title = "Diff",
  subtitle = "Unified diff produced by InfinitySnap.",
  filename = "run.diff",
  maxHeightClass = "max-h-[620px]",
  defaultQuery = "",
}: {
  diff: string;
  title?: string;
  subtitle?: string;
  filename?: string;
  maxHeightClass?: string;
  defaultQuery?: string;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => splitLines(diff), [diff]);

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

  const {
    query,
    setQuery,
    queryRegex,
    matchIndex,
    matchLineIndexes,
    activeMatchLine,
    goNextMatch,
    goPrevMatch,
  } = useSearchNavigator({
    lines,
    defaultQuery,
    containerRef: bodyRef,
    ringClass: "ring-2 ring-amber-400/80",
  });

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(diff || "");
    } catch {}
  };

  const tone: Tone =
    counts.files === 0 && !diff?.trim()
      ? "neutral"
      : counts.dels > 0
      ? "warn"
      : "ok";

  return (
    <GlassCard>
      {/* Header (keep your glass header) */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="text-xs text-white/65">{subtitle}</div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={tone} title="Rough summary computed from unified diff">
                {counts.files} files · +{counts.adds} / -{counts.dels}
              </Badge>
              <Badge tone="neutral">{lines.length.toLocaleString()} lines</Badge>
              {queryRegex ? (
                <Badge tone="neutral">{matchLineIndexes.length} matches</Badge>
              ) : (
                <Badge tone="neutral">Search to jump</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconButton onClick={copyAll} title="Copy full diff">
              Copy
            </IconButton>
            <IconButton onClick={() => downloadText(filename, diff || "")} title="Download diff as a file">
              Download
            </IconButton>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.06] p-1 backdrop-blur">
              <button
                type="button"
                onClick={goPrevMatch}
                disabled={matchLineIndexes.length === 0}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white/90 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                title="Previous match"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={goNextMatch}
                disabled={matchLineIndexes.length === 0}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white/90 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                title="Next match"
              >
                Next
              </button>

              <span className="px-2 text-[11px] text-white/60">
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
              placeholder='Search diff (e.g., "package.json", "import", "fix")…'
              className={cx(
                "w-full rounded-2xl border px-3 py-2 text-sm outline-none transition",
                "border-white/15 bg-white/[0.06] text-white placeholder:text-white/40 backdrop-blur",
                "focus:border-white/25"
              )}
            />
          </div>
        </div>
      </div>

      {/* Body (FORCED WHITE PANEL) */}
      <div
        ref={bodyRef}
        className={cx(
          "overflow-auto",
          maxHeightClass,
          // the important part: solid white background + dark text
          "bg-white text-slate-900"
        )}
      >
        <div className="min-w-[760px]">
          {lines.length === 0 || !diff?.trim() ? (
            <div className="px-4 py-12 text-center text-xs text-slate-600">
              No diff content.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {lines.map((line, i) => {
                const k = lineKind(line);

                const isMatch = queryRegex ? queryRegex.test(line) : false;
                const isActiveMatch = activeMatchLine != null && activeMatchLine === i;

                // white theme row backgrounds
                const rowBg = isActiveMatch
                  ? "bg-amber-100"
                  : k === "hdr"
                  ? "bg-slate-100"
                  : k === "add"
                  ? "bg-emerald-50"
                  : k === "del"
                  ? "bg-rose-50"
                  : i % 2 === 0
                  ? "bg-white"
                  : "bg-slate-50";

                // text colors for white theme
                const textCls =
                  k === "hdr"
                    ? "text-slate-900 font-semibold"
                    : k === "add"
                    ? "text-emerald-900"
                    : k === "del"
                    ? "text-rose-900"
                    : "text-slate-800";

                return (
                  <div
                    key={i}
                    data-line={i}
                    className={cx("grid grid-cols-[74px_1fr] gap-3 px-4 py-1", rowBg)}
                  >
                    <div className="select-none text-right text-[11px] text-slate-500">
                      {String(i + 1).padStart(5, " ")}
                    </div>

                    <div className={cx("font-mono text-[11px] leading-5 whitespace-pre-wrap break-words", textCls)}>
                      {queryRegex && isMatch ? (
                        <HighlightedText
                          line={line}
                          query={query}
                          // highlight that works on white
                          markClassName="rounded bg-yellow-200 px-0.5 text-inherit"
                        />
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

      {/* Footer (keep footer readable on glass) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-white/65">
        <div>Tip: green = added, red = removed, gray = headers.</div>
        <div className="font-mono opacity-80">{filename}</div>
      </div>
    </GlassCard>
  );
}

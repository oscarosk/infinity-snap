"use client";

import { useEffect, useMemo, useState } from "react";
import { escapeRegExp } from "@/components/ui/escapeRegExp";

export function useSearchNavigator({
  lines,
  defaultQuery = "",
  containerRef,
  ringClass = "ring-2 ring-amber-400/70",
}: {
  lines: string[];
  defaultQuery?: string;
  containerRef: React.RefObject<HTMLElement | null>;
  ringClass?: string;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [matchIndex, setMatchIndex] = useState(0);

  const queryRegex = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    try {
      // non-global for safe repeated .test calls
      return new RegExp(escapeRegExp(q), "i");
    } catch {
      return null;
    }
  }, [query]);

  const matchLineIndexes = useMemo(() => {
    if (!queryRegex) return [];
    const idx: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (queryRegex.test(lines[i])) idx.push(i);
    }
    return idx;
  }, [lines, queryRegex]);

  useEffect(() => {
    setMatchIndex(0);
  }, [query]);

  const activeMatchLine = useMemo(() => {
    if (matchLineIndexes.length === 0) return null;
    const safe = Math.min(Math.max(matchIndex, 0), matchLineIndexes.length - 1);
    return matchLineIndexes[safe];
  }, [matchIndex, matchLineIndexes]);

  const scrollToLine = (lineIdx: number | null) => {
    if (lineIdx == null) return;
    const root = containerRef.current;
    if (!root) return;

    const el = root.querySelector(`[data-line="${lineIdx}"]`) as HTMLElement | null;
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // ringClass may include multiple classes
    const ringParts = ringClass.split(" ").filter(Boolean);
    el.classList.add(...ringParts);
    setTimeout(() => el.classList.remove(...ringParts), 700);
  };

  const goNextMatch = () => {
    if (matchLineIndexes.length === 0) return;
    setMatchIndex((prev) => {
      const next = (prev + 1) % matchLineIndexes.length;
      scrollToLine(matchLineIndexes[next]);
      return next;
    });
  };

  const goPrevMatch = () => {
    if (matchLineIndexes.length === 0) return;
    setMatchIndex((prev) => {
      const next = prev - 1 < 0 ? matchLineIndexes.length - 1 : prev - 1;
      scrollToLine(matchLineIndexes[next]);
      return next;
    });
  };

  return {
    query,
    setQuery,
    queryRegex,
    matchIndex,
    matchLineIndexes,
    activeMatchLine,
    goNextMatch,
    goPrevMatch,
    scrollToLine,
    setMatchIndex,
  };
}

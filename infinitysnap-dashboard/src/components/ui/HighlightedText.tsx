"use client";

import React from "react";
import { escapeRegExp } from "./escapeRegExp";

export default function HighlightedText({
  line,
  query,
  markClassName = "rounded bg-amber-300/40 px-0.5 text-inherit",
}: {
  line: string;
  query: string;
  markClassName?: string;
}) {
  const q = query.trim();
  if (!q) return <>{line}</>;

  const re = new RegExp(escapeRegExp(q), "ig");
  const parts: React.ReactNode[] = [];

  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    if (start > lastIndex) parts.push(line.slice(lastIndex, start));

    parts.push(
      <mark key={`${start}-${end}`} className={markClassName}>
        {line.slice(start, end)}
      </mark>
    );

    lastIndex = end;
    if (m.index === re.lastIndex) re.lastIndex++;
  }

  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return <>{parts}</>;
}

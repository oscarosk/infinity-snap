"use client";

import React from "react";
import { cx } from "./cx";

export type Tone = "ok" | "warn" | "bad" | "neutral";

export default function Badge({
  tone = "neutral",
  children,
  title,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  // Light mode: readable on bright surfaces
  // Dark mode: readable on your neon/glass shell
  const cls =
    tone === "ok"
      ? cx(
          "border-emerald-600/25 bg-emerald-500/15 text-emerald-950",
          "dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-50"
        )
      : tone === "bad"
      ? cx(
          "border-rose-600/25 bg-rose-500/15 text-rose-950",
          "dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-50"
        )
      : tone === "warn"
      ? cx(
          "border-amber-600/25 bg-amber-400/20 text-amber-950",
          "dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-50"
        )
      : cx(
          // neutral
          "border-slate-900/10 bg-white/70 text-slate-900",
          "dark:border-white/10 dark:bg-white/[0.06] dark:text-white/80"
        );

  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur",
        cls,
        className
      )}
    >
      {children}
    </span>
  );
}

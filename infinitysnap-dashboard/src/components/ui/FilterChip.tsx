"use client";

import * as React from "react";
import { cx } from "@/components/ui/cx";

export default function FilterChip({
  active,
  children,
  onClick,
  className,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        "backdrop-blur",
        active
          ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
          : "border-white/15 bg-white/50 text-slate-800 hover:bg-white/70 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10",
        className
      )}
    >
      {children}
    </button>
  );
}

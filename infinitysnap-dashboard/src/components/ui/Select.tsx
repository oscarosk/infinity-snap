"use client";

import * as React from "react";
import { cx } from "@/components/ui/cx";

export default function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx(
        "rounded-2xl border border-white/15 bg-white/50 px-3 py-2 text-sm font-semibold text-slate-900 backdrop-blur outline-none",
        "hover:bg-white/70",
        "dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10",
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

"use client";

import * as React from "react";
import { cx } from "@/components/ui/cx";

export default function TextInput({
  value,
  onChange,
  placeholder,
  className,
  left,
  right,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  type?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-3 py-2 backdrop-blur",
        "dark:border-white/10 dark:bg-white/5",
        className
      )}
    >
      {left ? <div className="shrink-0 text-slate-500 dark:text-slate-400">{left}</div> : null}

      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(
          "w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400",
          "dark:text-slate-100 dark:placeholder:text-slate-500"
        )}
      />

      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

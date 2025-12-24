"use client";

import React from "react";
import { cx } from "./cx";

export default function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-3xl border border-white/10 bg-white/[0.06]",
        "shadow-[0_18px_60px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

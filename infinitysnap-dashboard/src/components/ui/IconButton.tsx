"use client";

import React from "react";
import { cx } from "./cx";

export default function IconButton({
  children,
  onClick,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        "rounded-full px-4 py-2 text-xs font-semibold transition",
        "border border-white/12 bg-white/[0.05] text-white/90",
        "hover:bg-white/[0.08]",
        disabled && "opacity-60 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}

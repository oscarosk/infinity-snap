"use client";

import React from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "ok" | "warn" | "bad";
export type ButtonVariant = "subtle" | "primary" | "ghost" | "danger";

const ring = "ring-1 ring-white/6";
const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-0";

export function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl",
        "shadow-[0_10px_30px_-15px_rgba(0,0,0,0.6)]",
        ring,
        "p-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
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
  const cls =
    tone === "ok"
      ? cx(
          "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
          "shadow-[0_10px_25px_-18px_rgba(16,185,129,0.25)]"
        )
      : tone === "bad"
      ? cx(
          "border-rose-400/20 bg-rose-400/10 text-rose-100",
          "shadow-[0_10px_25px_-18px_rgba(244,63,94,0.25)]"
        )
      : tone === "warn"
      ? cx(
          "border-amber-300/20 bg-amber-300/10 text-amber-100",
          "shadow-[0_10px_25px_-18px_rgba(251,191,36,0.18)]"
        )
      : "border-white/10 bg-white/[0.06] text-white/80";

  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        "backdrop-blur",
        ring,
        cls,
        className
      )}
      title={title}
    >
      {children}
    </span>
  );
}

export function IconButton({
  children,
  onClick,
  disabled,
  title,
  className,
  type = "button",
  variant = "subtle",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit" | "reset";
  variant?: ButtonVariant;
}) {
  const base = cx(
    "inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition",
    "border backdrop-blur",
    ring,
    focusRing
  );

  const styles =
    variant === "primary"
      ? cx(
          "border-white/15 bg-white text-slate-950",
          "hover:bg-white/90 hover:-translate-y-0.5",
          "shadow-[0_16px_40px_-28px_rgba(255,255,255,0.35)]"
        )
      : variant === "danger"
      ? cx(
          "border-rose-400/20 bg-rose-400/10 text-rose-100",
          "hover:bg-rose-400/14 hover:-translate-y-0.5",
          "shadow-[0_16px_40px_-28px_rgba(244,63,94,0.25)]"
        )
      : variant === "ghost"
      ? cx(
          "border-white/10 bg-transparent text-white/80",
          "hover:bg-white/5 hover:text-white"
        )
      : cx(
          "border-white/10 bg-white/[0.06] text-white/85",
          "hover:bg-white/10 hover:text-white"
        );

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        base,
        styles,
        disabled ? "opacity-60 cursor-not-allowed hover:translate-y-0" : "",
        className
      )}
    >
      {children}
    </button>
  );
}

export function FilterChip({
  active,
  children,
  onClick,
  disabled,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        "rounded-full px-4 py-2 text-xs font-semibold transition border backdrop-blur",
        ring,
        focusRing,
        disabled
          ? "cursor-not-allowed opacity-60 border-white/10 bg-white/5 text-white/40"
          : active
          ? cx(
              "bg-white text-slate-950 border-white/15",
              "shadow-[0_16px_40px_-28px_rgba(255,255,255,0.35)]"
            )
          : "border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/10 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cx(
        "w-full rounded-2xl border px-3 py-2 text-sm outline-none transition backdrop-blur",
        ring,
        focusRing,
        "border-white/10 bg-white/[0.06] text-white placeholder:text-white/35",
        "focus:border-white/20 focus:bg-white/10",
        className
      )}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        "rounded-2xl border px-3 py-2 text-xs outline-none transition backdrop-blur",
        ring,
        focusRing,
        "border-white/10 bg-white/[0.06] text-white",
        "focus:border-white/20 focus:bg-white/10",
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#070A12]">
          {o.label}
        </option>
      ))}
    </select>
  );
}

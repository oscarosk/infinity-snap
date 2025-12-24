// src/app/dashboard/layout.tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function NavPill({
  href,
  children,
  active,
}: {
  href: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold transition",
        "border backdrop-blur",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A12]",
        active
          ? cx(
              "text-white",
              "border-white/15",
              "bg-gradient-to-r from-violet-500/90 via-fuchsia-500/85 to-cyan-400/80",
              "shadow-[0_10px_30px_-15px_rgba(0,0,0,0.75)]"
            )
          : cx(
              "text-white/80 hover:text-white",
              "border-white/10",
              "bg-white/[0.06] hover:bg-white/[0.10]"
            )
      )}
    >
      {children}
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // For /dashboard and deeper pages like /runs/[id], keep Overview active only on /dashboard
  const isOverview = pathname === "/dashboard";
  // These are anchors; they won't reflect in pathname, so we keep them non-active by pathname.
  // (They still look good as non-active pills.)
  // If you later add routes like /dashboard/runs or /dashboard/integrations, you can update these.
  const isRuns = false;
  const isIntegrations = false;

  return (
    <div className="min-h-screen text-white">
      {/* InfinitySnap Dark Background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[#070A12]" />
        <div className="absolute -top-48 left-1/2 h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-violet-500/30 via-fuchsia-500/18 to-cyan-400/18 blur-3xl" />
        <div className="absolute -bottom-56 right-[-160px] h-[720px] w-[720px] rounded-full bg-gradient-to-tr from-emerald-500/16 via-sky-500/12 to-violet-500/16 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] [background-size:26px_26px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.35)_65%,rgba(0,0,0,0.6)_100%)]" />
      </div>

      <div className="mx-auto w-full max-w-screen-2xl px-6 py-6">
        {/* Top bar */}
        <header className="sticky top-0 z-20 mb-6">
          <div
            className={cx(
              "rounded-3xl border border-white/10 px-4 py-3 backdrop-blur-xl",
              // slightly stronger glass so text/buttons never wash out
              "bg-white/[0.08]",
              "shadow-[0_12px_40px_-22px_rgba(0,0,0,0.85)]"
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-500 to-fuchsia-500 text-white shadow-sm">
                  <span className="text-lg font-semibold">∞</span>
                </div>

                <div className="leading-tight">
                  <p className="text-sm font-semibold tracking-tight">
                    InfinitySnap
                    <span className="ml-2 text-[11px] font-medium text-white/55">
                      Dashboard
                    </span>
                  </p>
                  <p className="text-xs text-white/65">
                    Evidence, patches, and verification — presented cleanly.
                  </p>
                </div>
              </div>

              <nav className="flex flex-wrap items-center gap-2">
                <NavPill href="/dashboard" active={isOverview}>
                  Overview
                </NavPill>

                {/* Anchors must be Link to avoid nested <a> hydration issues */}
                <NavPill href="/dashboard#runs" active={isRuns}>
                  Runs
                </NavPill>

                <NavPill href="/dashboard#integrations" active={isIntegrations}>
                  Integrations
                </NavPill>

                <Link
                  href="/"
                  className={cx(
                    "ml-1 inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    "border border-white/10 bg-white/[0.06] text-white/80 backdrop-blur",
                    "hover:bg-white/[0.10] hover:text-white",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A12]"
                  )}
                >
                  Back to site
                </Link>
              </nav>
            </div>
          </div>
        </header>

        <main>{children}</main>
      </div>
    </div>
  );
}

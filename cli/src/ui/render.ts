// cli/src/ui/render.ts
import chalk from "chalk";
import boxen from "boxen";

export type Tone = "muted" | "info" | "ok" | "warn" | "err";

const ICON = {
  info: "▶",
  ok: "✓",
  warn: "⚠",
  err: "✖",
  dot: "•",
};

const COLOR = {
  muted: (s: string) => chalk.gray(s),
  info: (s: string) => chalk.cyan(s),
  ok: (s: string) => chalk.green(s),
  warn: (s: string) => chalk.yellow(s),
  err: (s: string) => chalk.red(s),
};

function termWidth(fallback = 72) {
  const w = Number(process.stdout.columns || 0);
  return w > 40 ? Math.min(w, 120) : fallback;
}

export function truncate(s: string, max = 80) {
  const v = String(s ?? "");
  if (v.length <= max) return v;
  return v.slice(0, Math.max(0, max - 1)) + "…";
}

export function dim(s: string) {
  return COLOR.muted(String(s ?? ""));
}

export function hr() {
  const w = termWidth(72);
  console.log(COLOR.muted("─".repeat(w)));
}

export function spacer(n = 1) {
  for (let i = 0; i < n; i++) console.log("");
}

/** Small helper for consistent headings */
export function title(t: string) {
  return chalk.bold(t);
}

export function badge(text: string, tone: Tone) {
  const color =
    tone === "ok"
      ? chalk.green
      : tone === "warn"
      ? chalk.yellow
      : tone === "err"
      ? chalk.red
      : tone === "muted"
      ? chalk.gray
      : chalk.cyan;

  return color.bold(`[${text}]`);
}

export function printHeader(opts?: {
  subtitle?: string;
  status?: Array<{ label: string; value: string; tone?: Tone }>;
}) {
  const subtitle = opts?.subtitle ?? "AI-assisted sandbox · auto-fix · verify";

  // Brand line
  hr();
  console.log(title("♾️  InfinitySnap"));
  console.log(dim(subtitle));
  hr();

  const status = opts?.status ?? [];
  if (status.length) {
    const maxLabel = Math.min(
      14,
      Math.max(8, ...status.map((s) => String(s.label).length))
    );

    const line = status
      .map((s) => {
        const tone = s.tone ?? "muted";
        const label = dim(String(s.label).padEnd(maxLabel));
        const val = COLOR[tone](truncate(String(s.value), 48));
        return `${label} ${val}`;
      })
      .join(dim(`  ${ICON.dot}  `));

    console.log(line);
    hr();
  }

  spacer(1);
}

export function section(titleText: string, hint?: string) {
  spacer(1);
  console.log(title(titleText));
  if (hint) console.log(dim(hint));
  hr();
}

export function kv(label: string, value: string, tone: Tone = "muted") {
  const k = dim(label.padEnd(12));
  const v = COLOR[tone](String(value ?? ""));
  console.log(`${k} ${v}`);
}

export function info(msg: string) {
  console.log(COLOR.info(`${ICON.info} ${msg}`));
}
export function ok(msg: string) {
  console.log(COLOR.ok(`${ICON.ok} ${msg}`));
}
export function warn(msg: string) {
  console.log(COLOR.warn(`${ICON.warn} ${msg}`));
}
export function err(msg: string) {
  console.error(COLOR.err(`${ICON.err} ${msg}`));
}

export function formatMs(ms?: number) {
  if (ms === undefined || ms === null) return "n/a";
  const v = Number(ms);
  if (!Number.isFinite(v)) return "n/a";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export function box(titleText: string, bodyLines: string[], tone: Tone = "info") {
  const border =
    tone === "ok"
      ? "green"
      : tone === "warn"
      ? "yellow"
      : tone === "err"
      ? "red"
      : tone === "muted"
      ? "gray"
      : "cyan";

  const text = [chalk.bold(titleText), "", ...bodyLines].join("\n");

  console.log(
    boxen(text, {
      padding: 1,
      margin: 0,
      borderStyle: "round",
      borderColor: border as any,
      width: Math.min(termWidth(72), 96),
    })
  );
}

/**
 * Example:
 * pipeline("ANALYZE", ["SNAP","ANALYZE","FIX","VERIFY"])
 * SNAP → ANALYZE → FIX → VERIFY (active is highlighted)
 */
export function pipeline(active: string, steps: string[]) {
  const parts = steps.map((s) => {
    if (s === active) return chalk.bold.cyan(s);
    return chalk.gray(s);
  });
  console.log(parts.join(chalk.gray("  →  ")));
}

/**
 * Optional helper: quick table for list command / runs
 * rows: array of string columns
 */
export function table(rows: string[][], opts?: { colGap?: number }) {
  const gap = opts?.colGap ?? 2;
  if (!rows.length) return;

  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] || 0, String(cell).length);
    });
  }

  for (const row of rows) {
    const line = row
      .map((cell, i) => String(cell).padEnd(widths[i] || 0))
      .join(" ".repeat(gap));
    console.log(line);
  }
}

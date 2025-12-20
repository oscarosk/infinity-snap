// cli/src/commands/list.ts
import chalk from "chalk";
import { apiResults } from "../apiClient";
import { API_BASE, baseNoApiV1 } from "../config";
import { printHeader, section, ok, warn, err, box, badge, spacer } from "../ui/render";

type RunRow = {
  id?: string;
  runId?: string;
  _id?: string;
  ts?: number | string;
  createdAt?: number | string;
  file?: string;
  status?: string;
  repo?: string;
  repoPath?: string;
  command?: string;
};

function pickId(r: RunRow): string {
  return String(r.id || r.runId || r._id || "unknown");
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTs(v: any): string {
  const d = toDate(v);
  if (!d) return "—";
  // 2025-12-16 16:56:12Z (compact, stable)
  return d.toISOString().replace("T", " ").replace(".000Z", "Z");
}

function toneForStatus(status?: string) {
  const s = String(status || "").toLowerCase();
  if (!s) return "muted" as const;
  if (s.includes("verified") || s.includes("success") || s === "ok") return "ok" as const;
  if (s.includes("refused") || s.includes("blocked") || s.includes("rolled_back")) return "warn" as const;
  if (s.includes("fail") || s.includes("error") || s.includes("panic")) return "err" as const;
  if (s.includes("running") || s.includes("started")) return "info" as const;
  return "info" as const;
}

function colorStatus(status: string) {
  const tone = toneForStatus(status);
  if (tone === "ok") return chalk.green(status);
  if (tone === "warn") return chalk.yellow(status);
  if (tone === "err") return chalk.red(status);
  return chalk.cyan(status);
}

function clamp(s: string, max: number) {
  const v = String(s ?? "");
  if (v.length <= max) return v;
  return v.slice(0, Math.max(0, max - 1)) + "…";
}

function padRight(s: string, w: number) {
  const v = String(s ?? "");
  if (v.length >= w) return v;
  return v + " ".repeat(w - v.length);
}

function safeStr(v: any, fallback = "—") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

export async function runList() {
  const backendBase = baseNoApiV1(API_BASE).replace(/\/$/, "");

  printHeader({
    status: [
      { label: "Mode", value: "RUNS", tone: "info" },
      { label: "API", value: API_BASE, tone: "muted" },
    ],
  });

  section("Run History", "Recent runs (most recent first)");

  try {
    const data = await apiResults();

    if (!data?.ok) {
      err(data?.error || "Failed to list runs.");
      box(
        "Backend not responding",
        [
          `${badge("CHECK", "warn")} Is backend running?`,
          chalk.cyan("  cd backend && npm run dev"),
          "",
          chalk.gray(`Expected: ${backendBase}`),
        ],
        "warn"
      );
      return;
    }

    const results: RunRow[] = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      warn("No runs found yet.");
      box(
        "Try this",
        [
          `${badge("DEMO", "ok")}  ${chalk.cyan('infinitysnap fix . --command "npm test"')}`,
          `${badge("FAST", "info")}  ${chalk.cyan("infinitysnap quick .")}`,
          `${badge("HEALTH", "info")}  ${chalk.cyan("infinitysnap doctor")}`,
        ],
        "info"
      );
      return;
    }

    ok(`Found ${results.length} run(s)`);
    spacer(1);

    // ---- Table layout ----
    // Keep widths conservative so it looks good on small terminals
    const COL_N = 3;
    const COL_ID = 18;
    const COL_TIME = 20;
    const COL_STATUS = 14;
    const COL_FILE = 28;

    const header =
      chalk.gray(
        `${padRight("#", COL_N)} ` +
        `${padRight("RUN ID", COL_ID)} ` +
        `${padRight("TIME", COL_TIME)} ` +
        `${padRight("STATUS", COL_STATUS)} ` +
        `FILE`
      );

    console.log(header);

    const rows = results.slice(0, 25);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const id = clamp(pickId(r), COL_ID);
      const ts = clamp(formatTs(r.ts ?? r.createdAt), COL_TIME);
      const statusRaw = safeStr(r.status, "—");
      const status = clamp(statusRaw, COL_STATUS);
      const file = clamp(safeStr(r.file, "—"), COL_FILE);

      const line =
        `${padRight(String(i + 1), COL_N)} ` +
        `${padRight(chalk.magenta(id), COL_ID)} ` +
        `${padRight(chalk.gray(ts), COL_TIME)} ` +
        `${padRight(colorStatus(status), COL_STATUS)} ` +
        `${chalk.yellow(file)}`;

      console.log(line);
    }

    spacer(1);

    box(
      "Quick actions",
      [
        `${badge("VIEW", "ok")}   ${chalk.cyan("infinitysnap view <runId>")}`,
        `${badge("OPEN", "ok")}   ${chalk.cyan("infinitysnap open <runId>")}`,
        `${badge("WATCH", "info")}  ${chalk.cyan("infinitysnap watch <runId>")}`,
      ],
      "info"
    );

    spacer(1);
    console.log(chalk.gray("Tip: if you don’t see new runs, ensure backend is reachable and you’re using the same API_BASE."));
  } catch (e: any) {
    err(e?.message || String(e));
    box(
      "Troubleshoot",
      [
        `${badge("CHECK", "warn")}  ${chalk.cyan("infinitysnap doctor")}`,
        `${badge("API", "info")}    ${chalk.gray(API_BASE)}`,
      ],
      "warn"
    );
  }
}

// cli/src/commands/view.ts
import chalk from "chalk";
import { apiResultFile, apiTimelineTxt } from "../apiClient";
import { API_BASE, baseNoApiV1 } from "../config";
import { printHeader, section, kv, warn, err, box, badge, spacer, formatMs } from "../ui/render";

type AnyObj = Record<string, any>;

function safeJson(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pick(obj: AnyObj, keys: string[]) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return obj[k];
  }
  return null;
}

function toStr(v: any, fallback = "—") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toneForStatus(status?: string) {
  const s = String(status || "").toLowerCase();
  if (!s) return "muted" as const;
  if (s.includes("verified") || s.includes("success") || s === "ok") return "ok" as const;
  if (s.includes("refused") || s.includes("blocked") || s.includes("rolled_back")) return "warn" as const;
  if (s.includes("fail") || s.includes("error")) return "err" as const;
  if (s.includes("running") || s.includes("started")) return "info" as const;
  return "info" as const;
}

function tailLines(text: string, n = 20) {
  const lines = String(text || "").trimEnd().split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

function isRawRequested(): boolean {
  // Works even before you add commander flag (user can do: infinitysnap view <id> --raw)
  return process.argv.includes("--raw") || process.argv.includes("-r");
}

export async function runView(runIdOrFile: string) {
  const backendBase = baseNoApiV1(API_BASE).replace(/\/$/, "");
  const rawMode = isRawRequested();

  printHeader({
    status: [
      { label: "Mode", value: rawMode ? "VIEW (RAW)" : "VIEW", tone: "info" },
      { label: "API", value: API_BASE, tone: "muted" },
    ],
  });

  section("Run Details", "Summary first, then artifacts / raw payload");

  try {
    const file = runIdOrFile.endsWith(".json") ? runIdOrFile : `${runIdOrFile}.json`;
    const data = await apiResultFile(file);

    if (!data?.ok) {
      err(data?.error || "Failed to fetch run.");
      box(
        "Not found",
        [
          `${badge("TIP", "warn")} List runs: ${chalk.cyan("infinitysnap list")}`,
          `${badge("TIP", "warn")} Try passing full filename: ${chalk.cyan("<runId>.json")}`,
          "",
          chalk.gray(`Expected backend: ${backendBase}`),
        ],
        "warn"
      );
      return;
    }

    const payload = (data.data || {}) as AnyObj;

    // --- Normalize common fields across backend versions ---
    const runId = toStr(pick(payload, ["runId", "id", "_id"]), toStr(runIdOrFile));
    const status = toStr(pick(payload, ["status", "state"]), "—");
    const tone = toneForStatus(status);

    const repo = toStr(pick(payload, ["repoPath", "repo", "meta", "meta.repoPath"]), "—");
    const command = toStr(pick(payload, ["command", "meta", "meta.command"]), "—");

    const analysis = (pick(payload, ["analysis"]) || {}) as AnyObj;
    const summary = toStr(pick(analysis, ["summary", "rootCause"]), "");
    const language = toStr(pick(analysis, ["languageGuess", "language"]), "");
    const errorDetected = pick(analysis, ["errorDetected"]);
    const stackDetected = pick(analysis, ["stackDetected"]);
    const confidencePct = toNum(pick(analysis, ["confidence"])); // your backend prints percent sometimes

    const runResult = (pick(payload, ["runResult"]) || {}) as AnyObj;
    const exitCode = pick(runResult, ["code"]);
    const durationMs = toNum(pick(runResult, ["durationMs"]));

    // Fix pipeline / verify fields (optional)
    const verify = (pick(payload, ["verify"]) || {}) as AnyObj;
    const verifyCode = pick(verify, ["code"]);
    const verifyDuration = toNum(pick(verify, ["durationMs"]));

    // ---- Run card ----
    box(
      "Run",
      [
        `${badge("ID", "info")}   ${chalk.magenta(runId)}`,
        `${badge("STATUS", tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "err" ? "err" : "info")}   ${status}`,
        `${badge("REPO", "info")} ${chalk.cyan(repo)}`,
        `${badge("CMD", "info")}  ${chalk.yellow(command)}`,
        "",
        `${badge("SNAP", "info")} exit=${toStr(exitCode)}  time=${formatMs(durationMs ?? undefined)}`,
        verifyCode !== undefined
          ? `${badge("VERIFY", "info")} exit=${toStr(verifyCode)}  time=${formatMs(verifyDuration ?? undefined)}`
          : chalk.gray("VERIFY: —"),
      ],
      tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "err" ? "err" : "info"
    );

    spacer(1);

    // ---- Analysis card ----
    if (summary || language || confidencePct !== null || errorDetected !== null) {
      const lines: string[] = [];
      if (summary) lines.push(chalk.gray(summary));
      if (summary) lines.push("");

      if (language) lines.push(`${badge("LANG", "info")} ${language}`);
      if (typeof errorDetected === "boolean") lines.push(`${badge("ERROR", errorDetected ? "warn" : "ok")} ${String(errorDetected)}`);
      if (typeof stackDetected === "boolean") lines.push(`${badge("STACK", stackDetected ? "info" : "muted")} ${String(stackDetected)}`);
      if (confidencePct !== null) lines.push(`${badge("CONF", "info")} ${confidencePct}%`);

      box("Analyzer", lines.length ? lines : [chalk.gray("—")], "info");
      spacer(1);
    } else {
      warn("No analyzer summary detected in this run payload.");
      spacer(1);
    }

    // ---- Timeline tail (best-effort) ----
    try {
      const t = await apiTimelineTxt(runId);
      if (t && t.trim()) {
        section("Timeline", "Tail (most recent steps)");
        console.log(chalk.gray(tailLines(t, 22)));
        spacer(1);
      }
    } catch {
      // Timeline endpoint might not exist or run doesn't have it. Silent skip.
    }

    // ---- Raw JSON (only if asked, or always at end but clearly separated) ----
    if (rawMode) {
      section("Raw JSON", "Full payload (copy/paste)");
      console.log(safeJson(payload));
      spacer(1);
    } else {
      box(
        "Want the full payload?",
        [
          `${badge("RAW", "info")} ${chalk.cyan(`infinitysnap view ${runId} --raw`)}`,
          chalk.gray("Tip: raw mode is useful for debugging fields / judge screenshots."),
        ],
        "info"
      );
      spacer(1);
    }

    box(
      "Next",
      [
        `${badge("OPEN", "ok")}   ${chalk.cyan(`infinitysnap open ${runId}`)}`,
        `${badge("WATCH", "info")}  ${chalk.cyan(`infinitysnap watch ${runId}`)}`,
        `${badge("RUNS", "info")}   ${chalk.cyan("infinitysnap list")}`,
      ],
      "info"
    );
  } catch (e: any) {
    err(e?.message || String(e));
    box(
      "Troubleshoot",
      [
        `${badge("CHECK", "warn")} ${chalk.cyan("infinitysnap doctor")}`,
        `${badge("API", "info")}   ${chalk.gray(API_BASE)}`,
      ],
      "warn"
    );
  }
}

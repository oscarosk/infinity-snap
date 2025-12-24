// cli/src/commands/start.ts
import path from "path";
import fs from "fs/promises";
import inquirer from "inquirer";
import chalk from "chalk";

import { apiSnap, apiFix, apiTimelineTxt } from "../apiClient";
import { runClineFix } from "../clineFix";
import { API_BASE } from "../config";

import {
  printHeader,
  section,
  info,
  ok,
  warn,
  err,
  formatMs,
  kv,
  pipeline,
  box,
  badge,
  spacer,
} from "../ui/render";

import type { SnapResponse, OutputFormat, RunStartSummary, FixResponse } from "../types";

function toMs(v: unknown, fallbackMs: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

async function detectCommand(repoPath: string, override?: string): Promise<string> {
  if (override) return override;

  const pkgJsonPath = path.join(repoPath, "package.json");
  try {
    const raw = await fs.readFile(pkgJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.scripts?.test) return "npm test";
    if (pkg.scripts?.start) return "npm start";
  } catch {}

  const indexJs = path.join(repoPath, "index.js");
  try {
    await fs.access(indexJs);
    return "node index.js";
  } catch {}

  throw new Error('Could not auto-detect command. Pass --command "npm test"');
}

function buildCombinedLog(runResult: any) {
  const out = (runResult?.stdout || "").trim();
  const errTxt = (runResult?.stderr || "").trim();
  return [out, errTxt].filter(Boolean).join("\n\n");
}

// --- JSON mode: keep stdout clean ---
function redirectLogsToStderrIfJson(format: OutputFormat) {
  if (format !== "json") return () => {};

  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origErr = console.error;

  console.log = (...args: any[]) => origErr(...args);
  console.info = (...args: any[]) => origErr(...args);
  console.warn = (...args: any[]) => origErr(...args);
  console.error = (...args: any[]) => origErr(...args);

  return () => {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origErr;
  };
}

function emitJsonIfNeeded(format: OutputFormat, payload: any) {
  if (format !== "json") return;
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function tailLines(text: string, n = 18) {
  const lines = String(text || "").trimEnd().split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

async function tryGetTimelineTail(runId: string) {
  try {
    const txt = await apiTimelineTxt(runId);
    const t = String(txt || "");
    if (!t.trim()) return null;
    return tailLines(t, 22);
  } catch {
    return null;
  }
}

async function tryPrintTimeline(runId: string) {
  try {
    const txt = await apiTimelineTxt(runId);
    if (txt && String(txt).trim()) {
      console.log(chalk.gray("\nTimeline (tail):"));
      console.log(chalk.gray(tailLines(String(txt), 22)));
    }
  } catch {}
}

function apiBaseForPrinting(): string {
  return String(API_BASE || "http://localhost:4000/api/v1").replace(/\/+$/, "");
}

function printArtifacts(runId: string) {
  spacer(1);
  console.log(chalk.gray("Artifacts:"));

  const apiBase = apiBaseForPrinting();
  console.log(chalk.gray(`- backend timeline: GET ${apiBase}/runs/${runId}/timeline`));
  console.log(chalk.gray(`- backend run JSON: GET ${apiBase}/runs/${runId}`));
  console.log(chalk.gray(`- local (Phase 5): .infinitysnap/report.json`));
  console.log(chalk.gray(`- local (Phase 5): .infinitysnap/timeline.txt`));
}

function endSummaryBox(params: {
  runId: string;
  repoPathAbs: string;
  command: string;
  status: string;
  confidence?: number | null;
  next?: string[];
}) {
  const { runId, repoPathAbs, command, status, confidence, next } = params;

  const statusTone =
    status === "verified" || status === "no_fix_needed"
      ? "ok"
      : status.startsWith("refused") || status.includes("blocked")
        ? "warn"
        : status.includes("failed") || status === "error"
          ? "err"
          : "info";

  const lines: string[] = [
    `${badge("RUN", "info")}  ${chalk.magenta(runId)}`,
    `${badge("REPO", "muted")} ${repoPathAbs}`,
    `${badge("CMD", "muted")}  ${command}`,
    `${badge("STATUS", statusTone as any)} ${status}`,
  ];

  if (typeof confidence === "number") {
    lines.push(`${badge("CONF", "info")}  ${confidence.toFixed(2)}`);
  }

  if (next?.length) {
    lines.push("");
    lines.push(chalk.bold("Next:"));
    for (const n of next) lines.push(`  ${chalk.cyan(n)}`);
  }

  box("InfinitySnap Result", lines, statusTone as any);
}

async function fetchBackendLogText(runId: string, logName: string): Promise<string | null> {
  const apiBase = apiBaseForPrinting();
  const url = `${apiBase}/runs/${encodeURIComponent(runId)}/logs?name=${encodeURIComponent(logName)}`;

  const key =
    (process.env.INFINITYSNAP_BACKEND_API_KEY || "").trim() ||
    (process.env.BACKEND_API_KEY || "").trim();

  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Normalize SnapResponse across backend versions:
 * - New backend: { ok, runId, data: RunRecord }
 * - Old backend: { ok, runId, runResult, analysis, ... }
 */
function normalizeSnap(snapData: any): {
  runId: string;
  runResult: any;
  analysis: any;
  data: any;
} {
  const payload = snapData?.data ?? snapData ?? {};
  const runId = String(snapData?.runId ?? payload?.runId ?? "").trim();
  return {
    runId,
    runResult: payload?.runResult ?? {},
    analysis: payload?.analysis ?? {},
    data: payload,
  };
}

async function verifyByResnap(repoPathAbs: string, command: string) {
  pipeline("VERIFY", ["SNAP", "ANALYZE", "FIX", "VERIFY"]);
  section("Verify", "Re-run after local edits (resnap)");

  const runTimeoutMs = toMs(process.env.INFINITYSNAP_RUN_TIMEOUT_MS, 180_000);

  const { startSpinner, stopSpinner } = await import("../ui/spinner");
  const verSpin = startSpinner("Re-running /snap …");

  try {
    const verifySnap: SnapResponse = await apiSnap({
      repoPathOnHost: repoPathAbs,
      command,
      timeoutMs: runTimeoutMs,
    });

    if (!(verifySnap as any).ok) {
      stopSpinner(verSpin, "fail");
      err(`Verify snap failed: ${(verifySnap as any).error || "Unknown error"}`);
      return { ok: false as const, code: undefined as number | undefined, verifySnap };
    }

    stopSpinner(verSpin, "stop");

    const n = normalizeSnap(verifySnap);
    const vr = n.runResult || {};
    kv("Exit", String(vr.code ?? "n/a"), vr.code === 0 ? "ok" : "warn");
    kv("Time", formatMs(vr.durationMs), "muted");

    return { ok: true as const, code: vr.code as number | undefined, verifySnap };
  } catch (e: any) {
    stopSpinner(verSpin, "fail");
    err(e?.message || String(e));
    return { ok: false as const, code: undefined as number | undefined, verifySnap: null };
  }
}

async function fallbackToClineFix(params: { repoPathAbs: string; command: string; runId: string; runResult: any }) {
  const { repoPathAbs, command, runId, runResult } = params;

  pipeline("FIX", ["SNAP", "ANALYZE", "FIX", "VERIFY"]);
  warn("Backend fix pipeline unavailable. Falling back to Cline (local repo edits).");

  const log = buildCombinedLog(runResult);

  const { startSpinner, stopSpinner } = await import("../ui/spinner");
  const clineSpin = startSpinner("Cline fixing repo locally …");

  let cr: Awaited<ReturnType<typeof runClineFix>>;
  try {
    cr = await runClineFix({ cwd: repoPathAbs, log, command });
    stopSpinner(clineSpin, "stop");
  } catch (e: any) {
    stopSpinner(clineSpin, "fail");
    err("Cline failed to run: " + (e?.message || String(e)));
    info(`runId: ${chalk.magenta(runId)}`);
    return { ok: false as const };
  }

  const v = await verifyByResnap(repoPathAbs, command);

  if (v.ok && v.code === 0) {
    ok("Cline fix successful — command now passes.");
    endSummaryBox({
      runId,
      repoPathAbs,
      command,
      status: "verified (cline-local)",
      next: [`infinitysnap view ${runId}`, `infinitysnap open ${runId}`],
    });
    return { ok: true as const };
  }

  err("Cline fix attempted but command still failing.");
  spacer(1);

  console.log(chalk.gray("Cline stdout (tail):"));
  console.log(chalk.gray((cr.stdout || "").slice(-1500)));
  spacer(1);
  console.log(chalk.gray("Cline stderr (tail):"));
  console.log(chalk.gray((cr.stderr || "").slice(-1500)));

  endSummaryBox({
    runId,
    repoPathAbs,
    command,
    status: "failed (cline-local)",
    next: [`infinitysnap view ${runId}`],
  });

  return { ok: false as const };
}

export async function runStart(opts: {
  repoPath?: string;
  command?: string;
  fix?: boolean;
  verify?: boolean;
  format?: OutputFormat;
}) {
  const format: OutputFormat = (opts.format || "text") as OutputFormat;
  const restoreConsole = redirectLogsToStderrIfJson(format);

  const runTimeoutMs = toMs(process.env.INFINITYSNAP_RUN_TIMEOUT_MS, 180_000);

  let repoPathAbs = path.resolve(opts.repoPath ?? process.cwd());
  let command: string | undefined;

  const backendUrl =
    process.env.INFINITYSNAP_BACKEND_URL ||
    process.env.INFINITYSNAP_API ||
    process.env.INFINITY_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:4000";

  const summary: RunStartSummary = {
    tool: "infinitysnap",
    mode: opts.fix ? "fix" : "snap",
    repoPath: repoPathAbs,
    command: null,
    runId: null,
    status: "started",
    artifacts: {
      endpoints: { timelineTxt: null, runJson: null },
      local: {
        reportJson: ".infinitysnap/report.json",
        timelineTxt: ".infinitysnap/timeline.txt",
      },
    },
    timelineTail: null,
  };

  printHeader({
    subtitle: "AI-assisted sandbox · auto-fix · verify",
    status: [
      { label: "Mode", value: opts.fix ? "FIX" : "SNAP", tone: opts.fix ? "info" : "muted" },
      { label: "Backend", value: backendUrl, tone: "muted" },
    ],
  });

  pipeline("SNAP", ["SNAP", "ANALYZE", "FIX", "VERIFY"]);
  info(opts.fix ? "Fix pipeline (snap → analyze → cline → verify)" : "Snap pipeline (sandbox → analyze)");
  spacer(1);

  try {
    command = await detectCommand(repoPathAbs, opts.command);
  } catch (e: any) {
    warn(e?.message || "Auto-detect failed.");

    const answers = await inquirer.prompt<{ repoPath: string; command: string }>([
      { type: "input", name: "repoPath", message: "Repo path to run in:", default: repoPathAbs },
      { type: "input", name: "command", message: 'Command to run (e.g. "npm test"):', default: "npm test" },
    ]);

    repoPathAbs = path.resolve(answers.repoPath);
    command = answers.command;
  }

  if (!command) {
    err("No command provided.");
    summary.status = "error";
    summary.error = "No command provided";
    emitJsonIfNeeded(format, summary);
    restoreConsole();
    return;
  }

  summary.repoPath = repoPathAbs;
  summary.command = command;

  kv("Repo", repoPathAbs, "info");
  kv("Command", command, "warn");
  kv("RunTimeout", `${Math.round(runTimeoutMs / 1000)}s`, "muted");
  spacer(1);

  const { startSpinner, stopSpinner } = await import("../ui/spinner");

  // ---- Step 1: Snap ----
  section("Sandbox Snap", "Run in sandbox + capture logs");

  const snapSpin = startSpinner("Calling /snap …");
  let snapData: SnapResponse;

  try {
    snapData = await apiSnap({
      repoPathOnHost: repoPathAbs,
      command,
      timeoutMs: runTimeoutMs,
    });
    stopSpinner(snapSpin, "stop");
  } catch (e: any) {
    stopSpinner(snapSpin, "fail");
    err(e?.message || String(e));
    summary.status = "error";
    summary.error = e?.message || String(e);
    emitJsonIfNeeded(format, summary);
    restoreConsole();
    return;
  }

  if (!(snapData as any).ok) {
    err(`Snap failed: ${(snapData as any).error || "Unknown error"}`);
    summary.status = "snap_failed";
    summary.error = (snapData as any).error || "snap_failed";
    emitJsonIfNeeded(format, summary);
    restoreConsole();
    return;
  }

  const norm = normalizeSnap(snapData);

  const runId = norm.runId;
  const runResult = norm.runResult || {};
  const analysis = norm.analysis || {};

  summary.runId = runId;
  summary.analysis = analysis;

  const apiBase = apiBaseForPrinting();
  summary.artifacts.endpoints.timelineTxt = `${apiBase}/runs/${runId}/timeline`;
  summary.artifacts.endpoints.runJson = `${apiBase}/runs/${runId}`;

  kv("runId", String(runId), "info");
  kv("Exit", String(runResult.code ?? "n/a"), runResult.code === 0 ? "ok" : "warn");
  kv("Time", formatMs(runResult.durationMs), "muted");
  spacer(1);

  if (runResult.code == null) {
    warn("Run did not exit cleanly (exit code is null). Likely timed out or was killed.");
    summary.status = "snap_failed";
    summary.error = "runner_timeout_or_killed";
    summary.timelineTail = await tryGetTimelineTail(runId);
    emitJsonIfNeeded(format, summary);

    await tryPrintTimeline(runId);
    printArtifacts(runId);

    endSummaryBox({
      runId,
      repoPathAbs,
      command,
      status: summary.status,
      next: [`infinitysnap view ${runId}`],
    });

    restoreConsole();
    return;
  }

  // ---- Step 2: Analyzer ----
  section("Infinity Analyzer", "What we think went wrong (and how confident we are)");

  kv("Summary", String((analysis as any).summary || "(none)"), "muted");
  kv("Error", String((analysis as any).errorDetected), (analysis as any).errorDetected ? "warn" : "ok");
  kv("Stack", String((analysis as any).stackDetected), (analysis as any).stackDetected ? "warn" : "muted");
  kv("Lang", String((analysis as any).languageGuess || "unknown"), "muted");

  const conf = typeof (analysis as any).confidence === "number" ? `${(analysis as any).confidence}%` : "n/a";
  kv("Confidence", conf, typeof (analysis as any).confidence === "number" ? "info" : "muted");

  spacer(1);

  if (!opts.fix) {
    info("Snap-only mode: stopping after analysis.");
    summary.status = "snap_complete";
    summary.timelineTail = await tryGetTimelineTail(runId);
    emitJsonIfNeeded(format, summary);

    endSummaryBox({
      runId,
      repoPathAbs,
      command,
      status: summary.status,
      next: [`infinitysnap view ${runId}`, `infinitysnap open ${runId}`],
    });

    restoreConsole();
    return;
  }

  if (runResult.code === 0 || !(analysis as any).errorDetected) {
    ok("No fix required — command succeeded or no clear error detected.");
    summary.status = "no_fix_needed";
    summary.timelineTail = await tryGetTimelineTail(runId);
    emitJsonIfNeeded(format, summary);

    endSummaryBox({
      runId,
      repoPathAbs,
      command,
      status: summary.status,
      next: [`infinitysnap view ${runId}`],
    });

    restoreConsole();
    return;
  }

  // ---- Step 3: Backend Fix (Cline-only) ----
  section("Fix Pipeline", "Cline-only backend fix + verify");

  const fixTimeoutMs = toMs(process.env.INFINITYSNAP_FIX_TIMEOUT_MS, 60_000);

  const fixSpin = startSpinner("Calling /runs/:id/fix …");
  let fixResp: FixResponse | null = null;

  try {
    fixResp = await apiFix(runId, { command, timeoutMs: fixTimeoutMs });
    stopSpinner(fixSpin, "stop");
  } catch (e: any) {
    stopSpinner(fixSpin, "fail");
    warn("Backend /runs/:id/fix threw — falling back to local Cline.");
    summary.status = "fallback_cline";
    summary.fallback = { reason: "fix_call_failed", error: e?.message || String(e) };
    emitJsonIfNeeded(format, summary);

    await fallbackToClineFix({ repoPathAbs, command, runId, runResult });
    restoreConsole();
    return;
  }

  summary.fix = fixResp as any;

  const status = String((fixResp as any)?.status || ((fixResp as any)?.ok ? "verified" : "failed"));
  summary.status = status;

  if (status === "verified") {
    ok("Fix verified successfully.");
  } else if (status === "cline_failed") {
    warn("Backend Cline failed. Fetching backend Cline output log…");

    const txt = await fetchBackendLogText(runId, "fix.cline.output");
    if (txt) {
      spacer(1);
      console.log(chalk.gray("Backend fix.cline.output (tail):"));
      console.log(chalk.gray(tailLines(txt, 60)));
    } else {
      warn("Could not fetch fix.cline.output (missing key or endpoint unreachable).");
    }

    warn("Falling back to local Cline run to keep moving…");
    await fallbackToClineFix({ repoPathAbs, command, runId, runResult });
    restoreConsole();
    return;
  } else if (status.startsWith("refused")) {
    warn(`Refused: ${status}`);
  } else {
    warn(`Fix finished with status: ${status}`);
    const txt = await fetchBackendLogText(runId, "fix.cline.output");
    if (txt) {
      spacer(1);
      console.log(chalk.gray("Backend fix.cline.output (tail):"));
      console.log(chalk.gray(tailLines(txt, 40)));
    }
  }

  summary.timelineTail = await tryGetTimelineTail(runId);
  await tryPrintTimeline(runId);
  printArtifacts(runId);

  emitJsonIfNeeded(format, summary);

  endSummaryBox({
    runId,
    repoPathAbs,
    command,
    status: summary.status,
    confidence: typeof (fixResp as any)?.confidence?.score === "number" ? (fixResp as any).confidence.score : null,
    next: [`infinitysnap view ${runId}`, `infinitysnap open ${runId}`],
  });

  restoreConsole();
}

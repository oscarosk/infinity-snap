// cli/src/commands/watch.ts
import chalk from "chalk";
import { apiResultFile, apiTimelineTxt } from "../apiClient";
import { API_BASE, baseNoApiV1 } from "../config";
import { printHeader, section, kv, ok, warn, err, box, badge, spacer, pipeline } from "../ui/render";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Tone = "muted" | "info" | "ok" | "warn" | "err";

type WatchSummary = {
  status: string;
  tone: Tone;
  stage: "SNAP" | "ANALYZE" | "FIX" | "VERIFY" | "DONE";
  lastStep: string;
  summary: string;
  done: boolean;
};

function toneForStatus(status?: string): Tone {
  const s = String(status || "").toLowerCase();
  if (!s) return "muted";
  if (s.includes("verified") || s.includes("fixed") || s.includes("success") || s === "ok") return "ok";
  if (s.includes("refused") || s.includes("blocked") || s.includes("rolled_back")) return "warn";
  if (s.includes("fail") || s.includes("error")) return "err";
  if (s.includes("running") || s.includes("progress") || s.includes("executing") || s.includes("started")) return "info";
  return "info";
}

function coloredStatus(status: string) {
  const tone = toneForStatus(status);
  if (tone === "ok") return chalk.green(status);
  if (tone === "warn") return chalk.yellow(status);
  if (tone === "err") return chalk.red(status);
  if (tone === "info") return chalk.cyan(status);
  return chalk.gray(status);
}

function tailLines(text: string, n = 18) {
  const lines = String(text || "").trimEnd().split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

/**
 * Best-effort stage detection across different payload shapes.
 * Goal: make the UI feel consistent even if backend schema changes.
 */
function detectStage(run: any, status: string): WatchSummary["stage"] {
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const has = (needle: string) =>
    steps.some((s: any) => String(s?.name || "").toLowerCase().includes(needle));

  const st = String(status || "").toLowerCase();

  if (st === "verified" || st === "fixed" || st === "failed" || st === "done" || st === "rolled_back" || st.startsWith("refused")) {
    return "DONE";
  }

  // If we have explicit steps, use them:
  if (steps.length) {
    if (has("verify")) return "VERIFY";
    if (has("fix") || has("apply") || has("patch") || has("generate")) return "FIX";
    if (has("analy")) return "ANALYZE";
    if (has("snap") || has("sandbox")) return "SNAP";
  }

  // Fallback on fields:
  if (run?.verify) return "VERIFY";
  if (run?.patch || run?.diff || run?.applied || run?.fix || run?.rollback) return "FIX";
  if (run?.analysis) return "ANALYZE";
  return "SNAP";
}

function summarize(run: any): WatchSummary {
  const status =
    run?.status ||
    run?.final?.status ||
    (run?.verify?.code === 0 ? "verified" : undefined) ||
    (run?.verify?.code !== undefined ? "done" : undefined) ||
    (run?.done === true ? "done" : undefined) ||
    "running";

  const summary =
    run?.analysis?.summary ||
    run?.analysis?.rootCause ||
    run?.summary ||
    run?.error ||
    "";

  const lastStep =
    Array.isArray(run?.steps) && run.steps.length
      ? run.steps[run.steps.length - 1]
      : null;

  const lastStepLabel = lastStep
    ? `${lastStep.name || "step"}${lastStep.status ? ` (${lastStep.status})` : ""}`
    : "";

  const done =
    String(status).toLowerCase() === "verified" ||
    String(status).toLowerCase() === "fixed" ||
    String(status).toLowerCase() === "failed" ||
    String(status).toLowerCase() === "done" ||
    String(status).toLowerCase() === "rolled_back" ||
    String(status).toLowerCase().startsWith("refused") ||
    run?.done === true;

  const stage = detectStage(run, String(status));
  const tone = toneForStatus(String(status));

  return {
    status: String(status),
    tone,
    stage,
    lastStep: String(lastStepLabel || ""),
    summary: String(summary || ""),
    done,
  };
}

function compact(s: string, max = 260) {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1) + "…";
}

async function tryGetTimelineTail(runId: string) {
  try {
    const t = await apiTimelineTxt(runId);
    if (!t || !t.trim()) return null;
    return tailLines(t, 16);
  } catch {
    return null;
  }
}

export async function runWatch(runId: string, intervalSec = 1) {
  const backendBase = baseNoApiV1(API_BASE).replace(/\/$/, "");

  printHeader({
    status: [
      { label: "Mode", value: "WATCH", tone: "info" },
      { label: "runId", value: runId, tone: "muted" },
      { label: "Poll", value: `${intervalSec}s`, tone: "muted" },
    ],
  });

  section("Live Watch", "Pipeline ticker (polling). Ctrl+C to stop.");

  kv("api", API_BASE, "muted");
  kv("file", `${runId}.json`, "muted");
  spacer(1);

  // UI state
  let lastFingerprint = "";
  let lastStage: WatchSummary["stage"] | null = null;
  let notFoundCount = 0;
  const startedAt = Date.now();

  const STEPS = ["SNAP", "ANALYZE", "FIX", "VERIFY"] as const;

  while (true) {
    try {
      const data = await apiResultFile(`${runId}.json`);

      if (!data?.ok) {
        notFoundCount += 1;

        if (notFoundCount === 1) {
          warn(data?.error || "Run not found yet (still generating?).");
          box(
            "Waiting",
            [
              chalk.gray("This is normal if the backend writes results after the first step."),
              `${badge("TIP", "info")} Ensure backend is up: ${chalk.cyan("cd backend && npm run dev")}`,
              `${badge("API", "muted")} ${chalk.gray(backendBase)}`,
            ],
            "info"
          );
        } else if (notFoundCount % 6 === 0) {
          warn(`Still waiting… (${notFoundCount} checks)`);
        }

        await sleep(intervalSec * 1000);
        continue;
      }

      notFoundCount = 0;

      const run = data.data || {};
      const s = summarize(run);

      // Pipeline line (only re-print when stage changes)
      if (s.stage !== lastStage) {
        lastStage = s.stage;

        // DONE: highlight VERIFY as last step visually
        const active = s.stage === "DONE" ? "VERIFY" : s.stage;
        pipeline(active, [...STEPS]);

        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(chalk.gray(`elapsed: ${elapsed}s`));
      }

      // Print only meaningful updates
      const fingerprint = JSON.stringify([
        s.status,
        s.stage,
        s.lastStep,
        compact(s.summary, 320),
      ]);

      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;

        console.log(chalk.gray("—"));
        console.log("status   :", coloredStatus(s.status));
        console.log("stage    :", chalk.cyan(s.stage));
        if (s.lastStep) console.log("lastStep :", chalk.gray(s.lastStep));
        if (s.summary) console.log("summary  :", compact(s.summary, 420));
      }

      // If done, show a clean final card + optional timeline tail
      if (s.done) {
        spacer(1);
        ok("Run finished.");

        const tl = await tryGetTimelineTail(runId);

        box(
          "Result",
          [
            `${badge("STATUS", s.tone)} ${s.status}`,
            s.summary ? `${badge("SUMMARY", "muted")} ${compact(s.summary, 500)}` : `${badge("SUMMARY", "muted")} (none)`,
            tl ? "" : "",
            tl ? chalk.gray("Timeline (tail):\n" + tl) : chalk.gray("Timeline: (not available)"),
            "",
            `${badge("NEXT", "info")} ${chalk.cyan(`infinitysnap view ${runId}`)}`,
            `${badge("NEXT", "info")} ${chalk.cyan(`infinitysnap open ${runId}`)}`,
          ].filter(Boolean),
          s.tone === "ok" ? "ok" : s.tone === "warn" ? "warn" : s.tone === "err" ? "err" : "info"
        );

        return;
      }
    } catch (e: any) {
      err(e?.message || String(e));
      box(
        "Troubleshoot",
        [
          `${badge("CHECK", "warn")} If you see ECONNREFUSED, start backend:`,
          chalk.cyan("  cd backend && npm run dev"),
          "",
          `${badge("API", "muted")} ${chalk.gray(API_BASE)}`,
        ],
        "warn"
      );
    }

    await sleep(intervalSec * 1000);
  }
}

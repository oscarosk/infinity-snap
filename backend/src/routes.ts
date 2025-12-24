// backend/src/routes.ts
import express from "express";
import path from "path";
import fs from "fs/promises";
import { spawn } from "node:child_process";

import { runInSandbox, RunResult } from "./sandboxRunner";
import { analyzeFromStdoutStderr, Analysis } from "./analyzer";
import { Timeline } from "./timeline";
import { trace } from "./logger";

import {
  initStore,
  saveRun,
  readRun,
  appendStep,
  writeLog,
  writeMetrics,
  listRuns,
  metricsFilePath,
  patchFilePath,
  diffFilePath,
  artifactsDirFor,
  timelineFilePath,
  timelineJsonPath,
} from "./runStore";

import { generateRunId } from "./util";
import { verifyRun } from "./verifier";
import { checkCommand, clampLog } from "./policy";

import type { RunRecord } from "./types";

const router = express.Router();

// -----------------------------
// Auth middleware (optional)
// -----------------------------
function requireApiKey(req: any, res: any, next: any) {
  const key = (process.env.BACKEND_API_KEY || "").trim();
  if (!key) return next();
  const got = (req.headers["x-api-key"] || "").toString().trim();
  if (got !== key) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}

// Ensure store dirs exist
const READY = initStore();
async function ensureReady() {
  await READY;
}

// Strict runId
const RUN_ID_RE = /^[a-z0-9]+-[a-z0-9]+$/i;
function assertValidRunId(runId: string) {
  if (!RUN_ID_RE.test(runId)) throw new Error("invalid runId");
}

/**
 * ✅ Safe JSON stringify:
 * - handles BigInt (stringifies)
 * - handles circular refs (replaces with "[Circular]")
 * - handles Error objects (keeps message/stack)
 */
function safeJsonStringify(value: any): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === "bigint") return v.toString();

      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }

      if (v && typeof v === "object") {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }

      return v;
    },
    2
  );
}

/**
 * ✅ Bulletproof JSON responder
 * Prevents Express from sending "Internal Server Error" text when res.json() fails.
 */
function safeSendJson(res: any, status: number, body: any) {
  if (res.headersSent) return;
  try {
    const payload = safeJsonStringify(body);
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(payload);
  } catch {
    try {
      res.status(500).type("text/plain").send("Internal Server Error");
    } catch {}
  }
}

/**
 * Abort latch:
 * - req "aborted" fires on client abort
 * - res "close" fires always; treat as abort only if response not finished
 */
function createAbortLatch(req: any, res: any) {
  let aborted = false;

  req.on("aborted", () => {
    aborted = true;
  });

  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  return () => aborted;
}

async function withHardTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => Promise<void> | void
): Promise<T> {
  let t: NodeJS.Timeout | null = null;

  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(async () => {
      try {
        await onTimeout?.();
      } catch {}
      reject(new Error(`timeout_after_${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function normalizeTimeoutMs(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1_000, n);
}

// ============================================================
// Health
// ============================================================
router.get("/health", async (_req, res) => {
  await ensureReady();
  safeSendJson(res, 200, { ok: true, ts: Date.now(), service: "InfinitySnap backend" });
});

// ============================================================
// Runs list
// ============================================================
router.get("/runs", async (_req, res) => {
  try {
    await ensureReady();
    const runs = await listRuns();
    safeSendJson(res, 200, { ok: true, runs });
  } catch (e: any) {
    console.error("runs list error:", e);
    safeSendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
});

// Alias
router.get("/results", async (_req, res) => {
  try {
    await ensureReady();
    const runs = await listRuns();
    safeSendJson(res, 200, { ok: true, runs });
  } catch (e: any) {
    console.error("results alias error:", e);
    safeSendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
});

// ============================================================
// Run detail
// ============================================================
router.get("/runs/:id", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const data = await readRun(runId);
    safeSendJson(res, 200, { ok: true, runId, data });
  } catch {
    safeSendJson(res, 404, { ok: false, error: "NOT_FOUND", message: "run not found" });
  }
});

// ============================================================
// Artifacts index (UI expects this)
// ============================================================
router.get("/runs/:id/artifacts", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);

    const run = await readRun(runId);

    const diffP = run?.diffPath || diffFilePath(runId);
    const patchP = run?.patchPath || patchFilePath(runId);
    const tlTxtP = timelineFilePath(runId);
    const tlJsonP = timelineJsonPath(runId);
    const artDir = run?.artifactsDir || artifactsDirFor(runId);

    const exists = async (p: string) => {
      try {
        await fs.stat(p);
        return true;
      } catch {
        return false;
      }
    };

    const [hasDiff, hasPatch, hasTimelineTxt, hasTimelineJson, hasArtifactsDir] = await Promise.all([
      exists(diffP),
      exists(patchP),
      exists(tlTxtP),
      exists(tlJsonP),
      exists(artDir),
    ]);

    safeSendJson(res, 200, {
      ok: true,
      runId,
      status: run?.status || "unknown",
      artifactsDir: artDir,
      hasDiff,
      hasPatch,
      hasTimeline: hasTimelineTxt || hasTimelineJson || (Array.isArray(run?.steps) && run.steps.length > 0),
      logs: run?.logPaths
        ? Object.entries(run.logPaths).map(([name, p]) => ({ name, path: p, exists: true }))
        : [],
      confidence: run?.analysis?.confidence ?? run?.confidence ?? null,
      durationMs: run?.runResult?.durationMs ?? null,
      hasArtifactsDir,
    });
  } catch {
    safeSendJson(res, 404, { ok: false, error: "NOT_FOUND", message: "run not found" });
  }
});

// ============================================================
// Logs / Diff / Patch
// ============================================================
router.get("/runs/:id/logs", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);

    const run = await readRun(runId);
    const logName = String(req.query?.name || "").trim();

    if (logName) {
      const p = run?.logPaths?.[logName];
      if (!p) return safeSendJson(res, 404, { ok: false, error: "NOT_FOUND" });
      const txt = await fs.readFile(p, "utf-8");
      res.type("text/plain").send(txt);
      return;
    }

    safeSendJson(res, 200, { ok: true, runId, logPaths: run?.logPaths || {} });
  } catch {
    safeSendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  }
});

router.get("/runs/:id/diff", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const txt = await fs.readFile(diffFilePath(runId), "utf-8");
    res.type("text/plain").send(txt);
  } catch {
    res.status(404).type("text/plain").send("");
  }
});

router.get("/runs/:id/patch", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const txt = await fs.readFile(patchFilePath(runId), "utf-8");
    res.type("application/json").send(txt);
  } catch {
    res.status(200).type("application/json").send("[]");
  }
});

// ============================================================
// Timeline
// ============================================================
router.get("/runs/:id/timeline", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const txt = await Timeline.readTxt(timelineFilePath(runId));
    res.type("text/plain").send(txt);
  } catch {
    res.status(404).type("text/plain").send("No timeline for this run yet.");
  }
});

router.get("/runs/:id/timeline.json", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const json = await fs.readFile(timelineJsonPath(runId), "utf-8");
    safeSendJson(res, 200, JSON.parse(json));
  } catch {
    res.status(404).type("text/plain").send("No timeline json for this run yet.");
  }
});

// ============================================================
// POST /runs/start  (Alias: POST /snap)
// ============================================================
async function handleRunsStart(req: any, res: any) {
  const aborted = createAbortLatch(req, res);

  try {
    await ensureReady();

    const repoPathOnHost = String(req.body?.repoPathOnHost || "").trim();
    const command = String(req.body?.command || "").trim();

    if (!repoPathOnHost)
      return safeSendJson(res, 400, { ok: false, error: "BAD_REQUEST", message: "missing repoPathOnHost" });
    if (!command)
      return safeSendJson(res, 400, { ok: false, error: "BAD_REQUEST", message: "missing command" });

    const cmdDecision = checkCommand(command);
    if (!cmdDecision.ok) {
      return safeSendJson(res, 400, { ok: false, error: cmdDecision.code, message: cmdDecision.reason });
    }

    const runId = generateRunId();
    const nowIso = new Date().toISOString();

    const artDir = artifactsDirFor(runId);
    const timelinePath = timelineFilePath(runId);
    const timeline = new Timeline(timelinePath);

    // keep a separate trace file (NOT the timeline txt)
    const traceFile = path.join(artDir, "snap.trace.log");

    timeline.start("run.start", "sandbox.run", { repoPathOnHost, command });
    await timeline.flush().catch(() => {});

    const run: RunRecord = {
      runId,
      repoPath: repoPathOnHost,
      command,
      status: "running" as any,
      createdAt: nowIso,
      startedAt: nowIso as any,
      lastUpdatedAt: nowIso,
      finishedAt: null as any,
      steps: [],
      logPaths: {},
      confidence: { score: null, reasons: [] } as any,
      artifactsDir: artDir,
      diffPath: null as any,
      patchPath: null as any,
      metricsPath: metricsFilePath(runId),
    } as any;

    await saveRun(run);

    await trace(traceFile, "snap.start", { runId, repoPathOnHost, command });

    await appendStep(runId, {
      type: "sandbox.run",
      message: "Running command in sandbox",
      ts: Date.now(),
      meta: { command },
    });

    // SNAP still uses hard-timeout (good safety)
    const timeoutMs = normalizeTimeoutMs(req.body?.timeoutMs ?? req.body?.runTimeoutSec * 1000, 180_000);
    const hardMs = Math.max(10_000, timeoutMs + 5_000);

    timeline.start("sandbox.exec", "sandbox.exec.start", { command, timeoutMs, hardMs });
    await timeline.flush().catch(() => {});

    await appendStep(runId, {
      type: "sandbox.exec.start",
      message: "Executing command",
      ts: Date.now(),
      meta: { command, timeoutMs },
    });

    const t0 = Date.now();

    let rr: RunResult;
    try {
      rr = await withHardTimeout(
        runInSandbox({
          repoPathOnHost,
          command,
          timeoutMs,
          dockerImage: req.body?.dockerImage,
          mode: req.body?.mode,
          traceFile,
        } as any),
        hardMs,
        async () => {
          await trace(traceFile, "snap.hard_timeout", { runId, hardMs, timeoutMs });
          timeline.fail("sandbox.exec", `hard_timeout_${hardMs}ms`);
          await timeline.flush().catch(() => {});
        }
      );
    } catch (e: any) {
      const msg = e?.message || String(e);
      await trace(traceFile, "snap.exception", { runId, msg });

      rr = {
        ok: false,
        code: null,
        error: msg,
        stdout: "",
        stderr: msg,
        command,
        durationMs: Date.now() - t0,
        execMs: null as any,
        copyMs: null as any,
        mode: "direct" as any,
      } as any;

      timeline.fail("sandbox.exec", msg);
      await timeline.flush().catch(() => {});
    }

    const durationMs = Math.max(0, Date.now() - t0);

    if (rr?.code === 0) timeline.ok("sandbox.exec", "ok");
    else timeline.ok("sandbox.exec", `exit_${rr?.code ?? "null"}`);
    await timeline.flush().catch(() => {});

    run.logPaths = run.logPaths || {};
    run.logPaths["sandbox.stdout"] = await writeLog(runId, "sandbox.stdout", clampLog(String(rr?.stdout || "")));
    run.logPaths["sandbox.stderr"] = await writeLog(runId, "sandbox.stderr", clampLog(String(rr?.stderr || "")));

    run.runResult = { ...(rr as any), durationMs } as any;

    // ---- Analyzer ----
    timeline.start("run.analyze", "analysis.complete", {});
    await timeline.flush().catch(() => {});

    let analysis: Analysis = analyzeFromStdoutStderr(String(rr?.stdout || ""), String(rr?.stderr || ""));

    if (rr?.ok === true && rr?.code === 0) {
      analysis = {
        ...(analysis as any),
        summary: "Command succeeded.",
        confidence: 95,
        primaryErrorKind: "none",
        errorDetected: false,
        stackDetected: false,
      } as any;
    }

    run.analysis = analysis as any;

    await writeMetrics(runId, {
      runId,
      command,
      repoPathOnHost,
      durationMs,
      exitCode: rr?.code ?? null,
      ts: Date.now(),
    });

    run.status = "finished" as any;
    run.finishedAt = new Date().toISOString();
    run.lastUpdatedAt = new Date().toISOString();

    timeline.start("run.complete", "finished", {});
    timeline.ok("run.start", "finished");
    timeline.ok("run.complete", "finished");
    await timeline.flush().catch(() => {});

    await saveRun(run);

    if (aborted()) return;
    return safeSendJson(res, 200, { ok: true, runId, data: run });
  } catch (e: any) {
    console.error("runs/start error:", e);
    return safeSendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
}

router.post("/runs/start", requireApiKey, handleRunsStart);
router.post("/snap", requireApiKey, handleRunsStart);

// ============================================================
// Helpers: run Cline via scripts/cline.sh
// ============================================================
function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function clineScriptPath(): string {
  return path.resolve(projectRoot(), "scripts", "cline.sh");
}

function bashQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function runGitDiff(repoPath: string): Promise<string> {
  return await new Promise<string>((resolve) => {
    const child = spawn("bash", ["-lc", `git -C ${bashQuote(repoPath)} diff`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    if (child.stdout) child.stdout.on("data", (d) => (out += d.toString()));

    child.on("close", () => resolve(out || ""));
    child.on("error", () => resolve(""));
  });
}

/**
 * Run one Cline fix pass.
 * ✅ NO HARD TIMEOUT (fix-anyhow mode)
 * - we only stop if the client disconnects / request is aborted at HTTP layer.
 */
async function runClineFixOnce(opts: {
  runId: string;
  repoPath: string;
  command: string;
  analysisSummary: string;
  stdout: string;
  stderr: string;
}): Promise<{ ok: boolean; output: string; reason?: string }> {
  const script = clineScriptPath();
  const ctx = [
    `context: InfinitySnap`,
    `runId: ${opts.runId}`,
    `repoPath: ${opts.repoPath}`,
    `command: ${opts.command}`,
    ``,
    `analysisSummary:`,
    opts.analysisSummary || "(none)",
    ``,
    `stdout:`,
    opts.stdout || "(empty)",
    ``,
    `stderr:`,
    opts.stderr || "(empty)",
    ``,
  ].join("\n");

  const task = `Fix the failing repo. Apply minimal safe changes. Do not touch secrets. After changes, ensure "${opts.command}" passes.`;
  const cmd = `cd ${bashQuote(opts.repoPath)} && ${bashQuote(script)} ${bashQuote(task)}`;

  return await new Promise<{ ok: boolean; output: string; reason?: string }>((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("error", (e) => resolve({ ok: false, output: out + "\n" + err, reason: String(e) }));
    child.on("close", (code) => {
      const merged = (out + (err ? `\n\n[stderr]\n${err}` : "")).trim();
      resolve({ ok: code === 0, output: merged, reason: code === 0 ? undefined : `exit_${code}` });
    });

    try {
      child.stdin.write(ctx);
      child.stdin.end();
    } catch {}
  });
}

// ============================================================
// FIX PIPELINE (Cline-only): cline → diff → verify
// ✅ FIX-ANYHOW: no 60s hard timeout, no timeout_after_60000ms
// ============================================================
router.post("/runs/:id/fix", requireApiKey, async (req, res) => {
  const runId = String(req.params.id || "").trim();
  const aborted = createAbortLatch(req, res);

  try {
    await ensureReady();
    assertValidRunId(runId);

    const timeline = new Timeline(timelineFilePath(runId));

    const run = await readRun(runId).catch(() => null as any);
    if (!run) {
      return safeSendJson(res, 404, { ok: false, error: "NOT_FOUND", message: "run not found" });
    }

    const cmd = String(req.body?.command || run.command || "").trim();
    if (!cmd) return safeSendJson(res, 400, { ok: false, error: "BAD_REQUEST", message: "missing command" });

    const cmdDecision = checkCommand(cmd);
    if (!cmdDecision.ok) {
      return safeSendJson(res, 400, { ok: false, error: cmdDecision.code, message: cmdDecision.reason });
    }

    // ✅ IMPORTANT:
    // Fix route does NOT hard-timeout. This prevents "timeout_after_60000ms" and CLI fallback.
    timeline.start("fix.start", "start (running cline + verify)", { command: cmd, timeoutMs: 0 });
    await timeline.flush().catch(() => {});

    const traceFile = path.join(artifactsDirFor(runId), "fix.trace.log");
    await trace(traceFile, "fix.start", { runId, repoPath: run.repoPath, command: cmd, timeoutMs: 0 });

    const analysisSummary = String(run.analysis?.summary || "No analysis summary");
    const stdoutPath = run?.logPaths?.["sandbox.stdout"];
    const stderrPath = run?.logPaths?.["sandbox.stderr"];

    const stdout = stdoutPath ? await fs.readFile(stdoutPath, "utf-8").catch(() => "") : "";
    const stderr = stderrPath ? await fs.readFile(stderrPath, "utf-8").catch(() => "") : "";

    await appendStep(runId, { type: "fix.cline.start", message: "Running Cline fix", ts: Date.now(), meta: { timeoutMs: 0 } });

    timeline.start("fix.cline", "cline.execute", { timeoutMs: 0 });
    await timeline.flush().catch(() => {});

    // If client disconnects, stop early (don’t keep working forever)
    if (aborted()) {
      timeline.fail("fix.cline", "client_aborted");
      await timeline.flush().catch(() => {});
      return;
    }

    const cl = await runClineFixOnce({
      runId,
      repoPath: run.repoPath,
      command: cmd,
      analysisSummary,
      stdout,
      stderr,
    });

    run.logPaths = run.logPaths || {};
    run.logPaths["fix.cline.output"] = await writeLog(runId, "fix.cline.output", clampLog(cl.output || ""));
    run.lastUpdatedAt = new Date().toISOString();

    if (!cl.ok) {
      timeline.fail("fix.cline", cl.reason || "cline_failed");

      timeline.start("fix.complete", "finished", {});
      timeline.ok("fix.complete", "cline_failed");
      await timeline.flush().catch(() => {});

      run.status = "failed";
      await saveRun(run);
      return safeSendJson(res, 200, {
        ok: true,
        runId,
        status: "cline_failed",
        message: "Cline did not complete successfully (see fix.cline.output log).",
        traceFile,
        logPaths: run.logPaths,
      });
    }

    timeline.ok("fix.cline", "ok");
    await timeline.flush().catch(() => {});

    await appendStep(runId, { type: "fix.diff", message: "Capturing git diff", ts: Date.now() });

    timeline.start("fix.diff", "capturing git diff", {});
    await timeline.flush().catch(() => {});

    const diff = await runGitDiff(run.repoPath);
    if (diff) {
      await fs.writeFile(diffFilePath(runId), diff, "utf8").catch(() => {});
      run.diffPath = diffFilePath(runId);

      // keep placeholder stable
      await fs.writeFile(patchFilePath(runId), JSON.stringify([], null, 2), "utf8").catch(() => {});
      run.patchPath = patchFilePath(runId);

      timeline.ok("fix.diff", `diff_bytes=${diff.length}`);
    } else {
      run.diffPath = null;
      timeline.ok("fix.diff", "no_changes");
    }

    await timeline.flush().catch(() => {});

    run.status = "applied";
    run.applied = { appliedAt: new Date().toISOString(), files: [] };
    await saveRun(run);

    await appendStep(runId, {
      type: "fix.verify.start",
      message: "Verifying after Cline",
      ts: Date.now(),
      meta: { command: cmd },
    });

    timeline.start("fix.verify", "re-running command", { command: cmd });
    await timeline.flush().catch(() => {});

    // Verification can still be time-bounded by backend verifier / sandboxRunner;
    // but we do NOT kill the whole /fix HTTP request with a 60s wrapper.
    const vr = await verifyRun(runId, {
      command: cmd,
      timeoutMs: req.body?.verifyTimeoutMs ?? req.body?.timeoutMs, // allow override if you want
      dockerImage: req.body?.dockerImage,
    });

    run.status = vr.verifyResult?.ok ? "verified" : "failed";
    run.lastUpdatedAt = new Date().toISOString();
    await saveRun(run);

    if (vr.verifyResult?.ok) timeline.ok("fix.verify", "ok");
    else timeline.fail("fix.verify", "failed");

    timeline.start("fix.complete", "finished", {});
    timeline.ok("fix.complete", run.status);
    await timeline.flush().catch(() => {});

    return safeSendJson(res, 200, {
      ok: true,
      runId,
      status: run.status,
      diffPath: run.diffPath,
      verify: vr.verifyResult,
      logPaths: vr.logPaths,
      traceFile,
    });
  } catch (e: any) {
    console.error("Fix Error:", e);
    return safeSendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
});

export default router;

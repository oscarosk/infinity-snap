// backend/src/routes.ts
import express from "express";
import path from "path";
import fs from "fs/promises";
import axios from "axios";

import { runInSandbox, RunResult } from "./sandboxRunner";
import {
  analyzeLogs,
  analyzeFromStdoutStderr,
  Analysis,
} from "./analyzer";
import {
  generatePatchWithOumi,
  PatchSuggestion,
  PatchFile,
} from "./aiAdapter";
import {
  clineSearchDocs,
  clineFetchExample,
} from "./clineClient";

const router = express.Router();

// --------------------------
// Helpers / constants
// --------------------------

// Base data directory for all runtime files
const DATA_DIR = path.join(__dirname, "..", ".data");

// Subfolders for different kinds of artifacts
const RESULTS_DIR = path.join(DATA_DIR, "runs");        // backend/.data/runs
const PATCHES_DIR = path.join(DATA_DIR, "patches");     // backend/.data/patches
const ARTIFACTS_DIR =
  process.env.ARTIFACTS_DIR || path.join(DATA_DIR, "artifacts"); // backend/.data/artifacts

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await fs.mkdir(RESULTS_DIR, { recursive: true }).catch(() => {});
  await fs.mkdir(PATCHES_DIR, { recursive: true }).catch(() => {});
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true }).catch(() => {});
}
ensureDirs();

function makeRunId() {
  // simple unique id — timestamp (base36) + random suffix
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function saveRun(runId: string, payload: any) {
  const file = path.join(RESULTS_DIR, `${runId}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

async function readRun(runId: string) {
  const file = path.join(RESULTS_DIR, `${runId}.json`);
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function savePatch(
  runId: string,
  suggestion: PatchSuggestion | PatchSuggestion[]
) {
  const file = path.join(PATCHES_DIR, `${runId}-patch.json`);
  await fs.writeFile(file, JSON.stringify(suggestion, null, 2), "utf8");
  return file;
}

// --------------------------
// Health
// --------------------------
router.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// --------------------------
// POST /snap
// --------------------------
router.post("/snap", async (req, res) => {
  try {
    const rawPath: string | undefined =
      req.body?.repoPathOnHost ||
      req.body?.repoHostPath ||
      req.body?.path;
    const command: string | undefined = req.body?.command;
    const timeoutMs: number | undefined = req.body?.timeoutMs;
    const cleanup: boolean =
      req.body?.cleanup === undefined ? true : !!req.body?.cleanup;
    const dockerImage: string | undefined = req.body?.dockerImage;

    if (!rawPath || !command) {
      return res.status(400).json({
        ok: false,
        error:
          "Require repoPathOnHost (or repoHostPath/path) and command.",
      });
    }

    // Resolve candidate absolute paths
    const candidates = [
      path.resolve(rawPath),
      path.resolve(process.cwd(), rawPath),
      path.resolve(__dirname, "../../", rawPath),
    ];

    let absSrc: string | null = null;
    let lastErr: any = null;
    for (const c of candidates) {
      try {
        await fs.access(c);
        absSrc = c;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!absSrc) {
      return res.status(400).json({
        ok: false,
        error: `Source path not found. Tried:\n${candidates.join(
          "\n"
        )}\nLast error: ${lastErr?.message || lastErr}`,
      });
    }

    // create run id and early metadata
    const runId = makeRunId();
    const runMeta: any = {
      id: runId,
      repoPathOnHost: absSrc,
      command,
      createdAt: new Date().toISOString(),
      status: "running",
    };

    // persist early
    await saveRun(runId, runMeta);

    // perform the sandbox run
    const runResult: RunResult = await runInSandbox({
      repoPathOnHost: absSrc,
      command,
      timeoutMs,
      cleanup,
      dockerImage,
    });

    // analysis – use improved analyzer
    const analysis: Analysis = analyzeFromStdoutStderr(
      runResult.stdout || "",
      runResult.stderr || ""
    );

    // finalize run record
    const finalRecord = {
      ...runMeta,
      finishedAt: new Date().toISOString(),
      status: (runResult as any).ok ? "finished" : "failed",
      runResult,
      analysis,
      artifactsDir: path.join(ARTIFACTS_DIR, runId),
    };

    // ensure artifacts dir exists and save logs
    await fs
      .mkdir(finalRecord.artifactsDir, { recursive: true })
      .catch(() => {});
    await fs.writeFile(
      path.join(finalRecord.artifactsDir, "stdout.txt"),
      runResult.stdout || "",
      "utf8"
    );
    await fs.writeFile(
      path.join(finalRecord.artifactsDir, "stderr.txt"),
      runResult.stderr || "",
      "utf8"
    );

    await saveRun(runId, finalRecord);

    // return runId for followups
    return res.json({
      ok: true,
      runId,
      runResult,
      analysis,
      saved: path.join("backend", ".data", "runs", `${runId}.json`),
    });
  } catch (e: any) {
    console.error("Snap Error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// --------------------------
// POST /analyze
// --------------------------
router.post("/analyze", async (req, res) => {
  try {
    const logs: string = req.body?.logs;
    if (!logs)
      return res
        .status(400)
        .json({ ok: false, error: "missing logs" });

    const analysis = analyzeLogs(logs);
    return res.json({ ok: true, analysis });
  } catch (e: any) {
    console.error("Analyzer Error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// --------------------------
// POST /generate
//   Cline -> Oumi -> save suggestions -> start Kestra
// --------------------------
router.post("/generate", async (req, res) => {
  try {
    const runId = req.body?.runId;
    if (!runId)
      return res
        .status(400)
        .json({ ok: false, error: "missing runId" });

    // load run
    const run = await readRun(runId).catch(() => null);
    if (!run)
      return res
        .status(404)
        .json({ ok: false, error: "run not found" });

    const primary: string =
      run.analysis?.summary ||
      (run.runResult?.stderr || run.runResult?.stdout || "").slice(
        0,
        800
      );

    // 1) Query Cline to discover related repos / docs using the primary text
    let topRepos: string[] = [];
    try {
      const keywords = (primary || "")
        .replace(/\s+/g, " ")
        .slice(0, 400);
      topRepos = await clineSearchDocs(keywords);
      topRepos = Array.isArray(topRepos) ? topRepos.slice(0, 6) : [];
    } catch (e: any) {
      console.warn("clineSearchDocs failed:", e?.message || e);
    }

    // 2) Fetch a few example files/snippets from top repos
    const snippets: { path: string; content: string }[] = [];
    for (const r of (topRepos || []).slice(0, 3)) {
      try {
        const files = await clineFetchExample(r);
        for (const f of (files || []).slice(0, 3)) {
          snippets.push({
            path: f.path || "unknown",
            content: (f.content || "").slice(0, 50_000),
          });
        }
      } catch (e: any) {
        console.warn(
          "clineFetchExample failed for repo",
          r,
          e?.message || e
        );
      }
    }

    // 3) Call Oumi to generate patch candidates
    let suggestions: PatchSuggestion[] | null = null;
    try {
      suggestions = await generatePatchWithOumi({
        repoPath: run.repoPathOnHost,
        primaryError: primary,
        contextFiles: snippets,
        topRepos,
      });
    } catch (e: any) {
      console.error("generatePatchWithOumi error:", e?.message || e);
      return res.status(500).json({
        ok: false,
        error: "Oumi patch generation failed",
        details: e?.message || String(e),
      });
    }

    if (!suggestions || !suggestions.length) {
      // save marker for no suggestion
      run.suggestion = {
        available: false,
        generatedAt: new Date().toISOString(),
      };
      await saveRun(runId, run);
      return res.json({
        ok: true,
        runId,
        available: false,
        message: "No suggestion available from Oumi.",
      });
    }

    // persist patch suggestions
    const patchPath = await savePatch(runId, suggestions);

    // update run record
    run.suggestions = suggestions;
    run.suggestion = {
      available: true,
      path: patchPath,
      generatedAt: new Date().toISOString(),
    };
    await saveRun(runId, run);

    // start Kestra flow to verify suggestions (if Kestra configured)
    let kestraResp: any = null;
    try {
      kestraResp = await startKestraFlow(runId, suggestions, {
        command: run.command,
      });
      if (kestraResp && kestraResp.executionId) {
        run.kestraExecution = {
          id: kestraResp.executionId,
          startedAt: new Date().toISOString(),
          raw: kestraResp,
        };
        await saveRun(runId, run);
      }
    } catch (e: any) {
      console.warn(
        "startKestraFlow failed:",
        e?.message || e
      );
    }

    return res.json({
      ok: true,
      runId,
      suggestion: {
        confidence: suggestions[0]?.confidence || null,
        notes: suggestions[0]?.notes || "",
      },
      patchPath,
      kestra: kestraResp || null,
    });
  } catch (e: any) {
    console.error("Generate Error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// --------------------------
// POST /apply
//   Apply saved patch suggestions (with backup)
// --------------------------
router.post("/apply", async (req, res) => {
  try {
    const runId = req.body?.runId;
    const applyNow = !!req.body?.apply;
    if (!runId)
      return res
        .status(400)
        .json({ ok: false, error: "missing runId" });

    const run = await readRun(runId).catch(() => null);
    if (!run)
      return res
        .status(404)
        .json({ ok: false, error: "run not found" });

    if (!run.suggestion || !run.suggestion.available) {
      return res.status(400).json({
        ok: false,
        error: "no suggestion available for this run",
      });
    }

    const patchFile = run.suggestion.path;
    const suggestion: PatchSuggestion[] = JSON.parse(
      await fs.readFile(patchFile, "utf8")
    );

    const fileList = suggestion.flatMap((s) =>
      s.files.map((f: PatchFile) => f.path)
    );

    if (!applyNow) {
      return res.json({
        ok: true,
        runId,
        willApply: fileList,
        message:
          "call again with apply=true to actually write files",
      });
    }

    // Apply: write each file's `after` content to disk, with backup
    const backupDir = path.join(ARTIFACTS_DIR, runId, "backup");
    await fs.mkdir(backupDir, { recursive: true });

    for (const s of suggestion) {
      for (const f of s.files) {
        const absPath = path.isAbsolute(f.path)
          ? f.path
          : path.join(run.repoPathOnHost, f.path);

        try {
          const before = await fs
            .readFile(absPath, "utf8")
            .catch(() => null);
          const rel = path
            .relative(run.repoPathOnHost, absPath)
            .replace(/\//g, "_");
          await fs.writeFile(
            path.join(backupDir, `${rel}.before`),
            before ?? "",
            "utf8"
          );
        } catch {
          // ignore read error for new files
        }

        await fs.mkdir(path.dirname(absPath), {
          recursive: true,
        });
        await fs.writeFile(absPath, f.after, "utf8");
      }
    }

    run.applied = {
      appliedAt: new Date().toISOString(),
      files: fileList,
    };
    await saveRun(runId, run);

    return res.json({ ok: true, runId, applied: fileList });
  } catch (e: any) {
    console.error("Apply Error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// --------------------------
// POST /verify
// --------------------------
router.post("/verify", async (req, res) => {
  try {
    const runId = req.body?.runId;
    const cmd = req.body?.command;
    const timeoutMs = req.body?.timeoutMs;

    if (!runId)
      return res
        .status(400)
        .json({ ok: false, error: "missing runId" });

    const run = await readRun(runId).catch(() => null);
    if (!run)
      return res
        .status(404)
        .json({ ok: false, error: "run not found" });

    // pick command: parameter or original run command
    const commandToRun =
      cmd || run.command || run.runResult?.command || "npm test";

    const verifyResult: RunResult = await runInSandbox({
      repoPathOnHost: run.repoPathOnHost,
      command: commandToRun,
      timeoutMs,
      cleanup: true,
      dockerImage: req.body?.dockerImage,
    });

    run.verify = {
      verifiedAt: new Date().toISOString(),
      result: verifyResult,
    };
    await saveRun(runId, run);

    return res.json({ ok: true, runId, verify: verifyResult });
  } catch (e: any) {
    console.error("Verify Error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// --------------------------
// POST /results/:runId/kestra-callback
// Kestra will POST candidate verification results here
// --------------------------
router.post(
  "/results/:runId/kestra-callback",
  async (req, res) => {
    try {
      const runId = req.params.runId;
      const payload = req.body;

      if (!runId)
        return res
          .status(400)
          .json({ ok: false, error: "missing runId" });

      const run = await readRun(runId).catch(() => null);
      if (!run)
        return res
          .status(404)
          .json({ ok: false, error: "run not found" });

      const items = Array.isArray(payload) ? payload : [payload];

      run.verifications = run.verifications || {};
      for (const it of items) {
        const cid = it.candidateId || it.id || "unknown";
        run.verifications[cid] = run.verifications[cid] || {};
        run.verifications[cid][it.env || "default"] = {
          ok: !!it.ok,
          logs: it.logs || it.output || "",
          ts: new Date().toISOString(),
        };
      }

      // compute aggregate winner heuristic (simple: highest pass count then confidence)
      const scores: {
        cid: string;
        passCount: number;
        confidence: number;
      }[] = [];
      const candidateList: any[] = run.suggestions || [];
      for (const c of candidateList) {
        const cid =
          c.id ||
          (c.files && c.files[0] && c.files[0].path) ||
          "c-unknown";
        const v = run.verifications[cid] || {};
        const passCount = Object.values(v).filter(
          (x: any) => x.ok
        ).length;
        scores.push({
          cid,
          passCount,
          confidence: c.confidence || 0,
        });
      }

      scores.sort((a, b) => {
        if (b.passCount !== a.passCount)
          return b.passCount - a.passCount;
        return (b.confidence || 0) - (a.confidence || 0);
      });

      if (scores.length) {
        run.aggregate = {
          winner: scores[0].cid,
          scores,
          computedAt: new Date().toISOString(),
        };
      }

      await saveRun(runId, run);
      return res.json({ ok: true, updated: true });
    } catch (e: any) {
      console.error("Kestra callback error:", e);
      return res
        .status(500)
        .json({ ok: false, error: e?.message || String(e) });
    }
  }
);

// --------------------------
// GET /results  -> list saved runs
// --------------------------
router.get("/results", async (_req, res) => {
  try {
    const files = await fs.readdir(RESULTS_DIR);
    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const id = f.replace(".json", "");
        const ts = parseInt(id.split("-")[0], 36) || Date.now();
        return { file: f, id, ts, path: path.join(RESULTS_DIR, f) };
      })
      .sort((a, b) => b.ts - a.ts);

    res.json({ ok: true, results: jsonFiles });
  } catch (e: any) {
    console.error("Results list error:", e);
    res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// --------------------------
// GET /results/:file
// --------------------------
router.get("/results/:file", async (req, res) => {
  try {
    const file = req.params.file;
    if (!file || !file.endsWith(".json")) {
      return res.status(400).json({
        ok: false,
        error: "invalid filename; must end with .json",
      });
    }

    const full = path.join(RESULTS_DIR, file);
    const resolved = path.resolve(full);
    if (!resolved.startsWith(path.resolve(RESULTS_DIR))) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid file path" });
    }

    const data = await fs.readFile(full, "utf8");
    const parsed = JSON.parse(data);
    res.json({ ok: true, file, data: parsed });
  } catch (e: any) {
    console.error("Results fetch error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;

// --------------------------
// Helper: startKestraFlow
// --------------------------
async function startKestraFlow(
  runId: string,
  suggestions: PatchSuggestion[],
  opts: { command?: string } = {}
) {
  const kestraApi = process.env.KESTRA_API_URL;
  const kestraKey = process.env.KESTRA_API_KEY;
  if (!kestraApi || !kestraKey) {
    console.warn(
      "Kestra not configured (KESTRA_API_URL/KESTRA_API_KEY). Skipping flow start."
    );
    return null;
  }

  const candidates = (suggestions || []).map((s) => ({
    id: s.id || `${Math.random().toString(36).slice(2, 8)}`,
    confidence: s.confidence || 0,
    notes: s.notes || "",
    files: s.files || [],
  }));

  const backendUrl =
    process.env.BACKEND_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  const body = {
    inputs: {
      runId,
      backendUrl,
      backendApiKey: process.env.BACKEND_API_KEY || "",
      command: opts.command || "npm test",
      dockerImage: process.env.DEFAULT_VERIFY_IMAGE || "node:18",
      candidates,
      artifactsDir: path.join(ARTIFACTS_DIR, runId),
      callbackUrl: `${backendUrl}/results/${runId}/kestra-callback`,
    },
  };

  try {
    const flowNamespace =
      process.env.KESTRA_FLOW_NAMESPACE || "infinitysnap";
    const flowId =
      process.env.KESTRA_FLOW_ID || "infinitysnap.verify";

    const resp = await axios.post(
      `${kestraApi}/api/flows/${flowNamespace}/${flowId}/executions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${kestraKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      }
    );

    return {
      executionId:
        resp.data?.id || resp.data?.executionId || resp.data,
    };
  } catch (e: any) {
    console.error(
      "startKestraFlow error:",
      e?.response?.data || e?.message || e
    );
    throw e;
  }
}

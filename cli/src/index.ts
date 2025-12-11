#!/usr/bin/env node
import { Command } from "commander";
import axios from "axios";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import dotenv from "dotenv";

dotenv.config();

const API_BASE =
  process.env.INFINITYSNAP_API ?? "http://localhost:4000/api/v1";

// ---------- Pretty UI helpers ----------

function headerLine() {
  console.log("────────────────────────────────────────────────────────────");
}

function printHeader() {
  headerLine();
  console.log("♾️  「 ✦ InfinitySnap ✦ 」");
  console.log("AI-assisted sandbox · auto-fix · verify");
  headerLine();
  console.log();
}

function sectionTitle(title: string) {
  headerLine();
  console.log(chalk.bold(title));
  headerLine();
}

function formatMs(ms?: number) {
  if (!ms && ms !== 0) return "n/a";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function logInfo(msg: string) {
  console.log(chalk.cyan("▶"), msg);
}
function logOk(msg: string) {
  console.log(chalk.green("✓"), msg);
}
function logWarn(msg: string) {
  console.log(chalk.yellow("⚠"), msg);
}
function logErr(msg: string) {
  console.error(chalk.red("✖"), msg);
}

// ---------- Terminal capability detection ----------
// HARD-FORCED: always use basic numeric menu to avoid "Bye 👋" bug

function supportsFancyPrompts(): boolean {
  // We completely disable fancy prompts for now to avoid buggy behavior
  // in WSL / Git Bash / weird terminals.
  return false;
}

// ---------- Helpers: detect path & command ----------

async function detectCommand(
  repoPath: string,
  override?: string
): Promise<string> {
  if (override) return override;

  const pkgJsonPath = path.join(repoPath, "package.json");
  try {
    const raw = await fs.readFile(pkgJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.scripts?.test) return "npm test";
    if (pkg.scripts?.start) return "npm start";
  } catch {
    // ignore
  }

  const indexJs = path.join(repoPath, "index.js");
  try {
    await fs.access(indexJs);
    return "node index.js";
  } catch {
    // ignore
  }

  throw new Error(
    'Could not auto-detect command. Please pass --command (e.g., --command "npm test").'
  );
}

// ---------- Core pipeline: Quick Snap ----------

async function runQuickSnap(opts: {
  repoPath?: string;
  commandOverride?: string;
  fix?: boolean;
  verify?: boolean;
}) {
  let repoPath = path.resolve(opts.repoPath ?? process.cwd());
  let command: string | undefined;

  printHeader();
  console.log(chalk.bold("▶ Quick Snap — one-shot analyze & fix\n"));

  // 1) Try auto-detect first
  try {
    command = await detectCommand(repoPath, opts.commandOverride);
  } catch (e: any) {
    logWarn(e?.message || "Auto-detect failed.");

    // 2) Fallback: ask the user interactively
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "repoPath",
        message: "Repo path to run in:",
        default: repoPath,
      },
      {
        type: "input",
        name: "command",
        message: 'Command to run (e.g. "npm test" or "node index.js"):',
        default: "npm test",
      },
    ]);

    repoPath = path.resolve(answers.repoPath);
    command = answers.command;
  }

  if (!command) {
    logErr("No command provided.");
    return;
  }

  console.log("Repo     :", chalk.magenta(repoPath));
  console.log("Command  :", chalk.yellow(command));
  console.log();

  // Step 1 — /snap
  sectionTitle("▶ Snap — run in sandbox");

  try {
    logInfo("Calling /snap …");
    const snapResp = await axios.post(
      `${API_BASE}/snap`,
      {
        repoHostPath: repoPath,
        command,
        timeoutMs: 20000,
      },
      { timeout: 0 }
    );

    const data = snapResp.data;
    if (!data.ok) {
      logErr(`Snap failed: ${data.error || "Unknown error"}`);
      return;
    }

    const runId = data.runId as string;
    const runResult = data.runResult || {};
    const analysis = data.analysis || {};

    console.log();
    console.log("  runId         :", chalk.magenta(runId));
    console.log("  Exit code     :", runResult.code ?? "n/a");
    console.log("  Duration      :", formatMs(runResult.durationMs));
    console.log();

    if (runResult.stderr) {
      console.log(chalk.gray("stderr:"));
      console.log(chalk.gray(runResult.stderr));
      console.log();
    }

    // Step 2 — Analyzer
    sectionTitle("▶ Infinity Analyzer");

    console.log("  Summary       :", analysis.summary || "(none)");
    console.log("  Error detected:", String(analysis.errorDetected));
    console.log("  Stack detected:", String(analysis.stackDetected));
    console.log("  Language      :", analysis.languageGuess || "unknown");
    console.log(
      "  Confidence    :",
      typeof analysis.confidence === "number"
        ? `${analysis.confidence}%`
        : "n/a"
    );
    console.log();

    if (!opts.fix) {
      logInfo("No --fix flag passed, stopping after analysis.");
      console.log("runId:", chalk.magenta(runId));
      return;
    }

    // If command succeeded and no errors, nothing to fix
    if (runResult.code === 0 || !analysis.errorDetected) {
      logOk("No fix required — command succeeded or no clear error detected.");
      console.log("runId:", chalk.magenta(runId));
      return;
    }

    // Step 3 — generate patch
    sectionTitle("▶ Infinity Fix — generate patch");

    logInfo("Calling /generate …");
    const genResp = await axios.post(`${API_BASE}/generate`, { runId });
    const genData = genResp.data;

    if (!genData.ok) {
      logErr(`Generate failed: ${genData.error || "Unknown error"}`);
      return;
    }

    if (genData.available === false && !genData.suggestion) {
      logWarn(
        "No suggestion available for this run (external patch engine not configured or returned none)."
      );
      console.log("runId:", chalk.magenta(runId));
      return;
    }

    const suggestion = genData.suggestion || {};
    const patchPath = genData.patchPath || "(unknown)";
    console.log();
    logOk("Patch suggestion available");
    console.log("  Patch file    :", chalk.magenta(patchPath));
    if (suggestion.confidence !== undefined) {
      console.log(
        "  Confidence    :",
        `${Math.round((suggestion.confidence || 0) * 100)}%`
      );
    }
    if (suggestion.notes) {
      console.log("  Notes         :", suggestion.notes);
    }
    console.log();

    // Step 4 — preview /apply
    sectionTitle("▶ Apply preview");

    logInfo("Previewing /apply …");
    const previewResp = await axios.post(`${API_BASE}/apply`, { runId });
    const previewData = previewResp.data;

    if (!previewData.ok) {
      logErr(`Apply preview failed: ${previewData.error || "Unknown error"}`);
      return;
    }

    const willApply: string[] = previewData.willApply || [];
    if (!willApply.length) {
      logWarn("No files to apply — suggestion empty.");
      return;
    }

    console.log("Files that will be modified:");
    willApply.forEach((f) => console.log("  " + chalk.yellow(f)));
    console.log();

    // Actually apply
    logOk("Applying patch …");
    const applyResp = await axios.post(`${API_BASE}/apply`, {
      runId,
      apply: true,
    });
    const applyData = applyResp.data;
    if (!applyData.ok) {
      logErr(`Apply failed: ${applyData.error || "Unknown error"}`);
      return;
    }

    logOk("Patch applied");
    (applyData.applied || []).forEach((f: string) =>
      console.log("  " + chalk.green(f))
    );
    console.log();

    if (opts.verify === false) {
      logInfo(
        "Skipping verify step (--no-verify). You can run `infinitysnap show <runId>` later."
      );
      console.log("runId:", chalk.magenta(runId));
      return;
    }

    // Step 5 — verify
    sectionTitle("▶ Verify — re-run after fix");

    logInfo("Calling /verify …");
    const verifyResp = await axios.post(`${API_BASE}/verify`, {
      runId,
      command,
    });
    const verifyData = verifyResp.data;

    if (!verifyData.ok) {
      logErr(`Verify failed: ${verifyData.error || "Unknown error"}`);
      console.log("runId:", chalk.magenta(runId));
      return;
    }

    const vr = verifyData.verify || {};
    console.log("  Exit code     :", vr.code ?? "n/a");
    console.log("  Duration      :", formatMs(vr.durationMs));
    console.log();

    if (vr.code === 0) {
      console.log(
        chalk.green.bold("✅ Infinity Fix successful — command now passes.")
      );
    } else {
      console.log(
        chalk.red.bold(
          "❌ Fix attempted but command is still failing. Manual review recommended."
        )
      );
    }

    console.log();
    console.log("runId:", chalk.magenta(runId));
  } catch (e: any) {
    logErr(e?.message || String(e));
  }
}

// ---------- Guard Mode (simple interval loop) ----------

async function runGuardMode(opts: {
  repoPath?: string;
  commandOverride?: string;
  intervalSec?: number;
}) {
  const repoPath = path.resolve(opts.repoPath ?? process.cwd());
  let command: string;
  const intervalMs = (opts.intervalSec ?? 60) * 1000;

  printHeader();
  console.log(chalk.bold("▶ Guard Mode — watch & auto-fix\n"));
  console.log("Repo     :", chalk.magenta(repoPath));

  try {
    command = await detectCommand(repoPath, opts.commandOverride);
  } catch (e: any) {
    logErr(e?.message || String(e));
    return;
  }

  console.log("Command  :", chalk.yellow(command));
  console.log(
    "Interval :",
    `${opts.intervalSec ?? 60} s (Ctrl+C to stop guard mode)`
  );
  console.log();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      sectionTitle("⏱ Guard tick — running command …");

      const snapResp = await axios.post(
        `${API_BASE}/snap`,
        {
          repoHostPath: repoPath,
          command,
          timeoutMs: 20000,
        },
        { timeout: 0 }
      );
      const data = snapResp.data;
      const runId = data.runId;
      const runResult = data.runResult || {};
      const analysis = data.analysis || {};

      console.log("runId         :", chalk.magenta(runId));
      console.log("Exit code     :", runResult.code ?? "n/a");
      console.log("Duration      :", formatMs(runResult.durationMs));
      console.log("Error detected:", String(analysis.errorDetected));
      console.log();

      if (runResult.code === 0 || !analysis.errorDetected) {
        logOk("Guard: command succeeded — no fix needed.");
      } else {
        logWarn("Guard: failure detected — attempting auto-fix …");
        await runQuickSnap({
          repoPath,
          commandOverride: command,
          fix: true,
          verify: true,
        });
      }
    } catch (e: any) {
      logErr("Guard tick failed: " + (e?.message || String(e)));
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------- Other features: analyze, results, show, demo, config ----------

async function runAnalyzeFromFile(filePath: string) {
  printHeader();
  console.log(chalk.bold("▶ Analyze Logs from file\n"));

  try {
    const abs = path.resolve(filePath);
    const logs = await fs.readFile(abs, "utf8");
    logInfo(`Sending logs from: ${abs}`);
    const resp = await axios.post(`${API_BASE}/analyze`, { logs });
    const data = resp.data;
    if (!data.ok) {
      logErr(data.error || "Analyzer failed");
      return;
    }
    console.log();
    console.log(chalk.green("Analysis:"));
    console.log(JSON.stringify(data.analysis, null, 2));
  } catch (e: any) {
    logErr(e?.message || String(e));
  }
}

async function runListResults() {
  printHeader();
  console.log(chalk.bold("▶ View Past Runs\n"));
  try {
    const resp = await axios.get(`${API_BASE}/results`);
    const data = resp.data;
    if (!data.ok) {
      logErr(data.error || "Failed to list results");
      return;
    }
    const results: any[] = data.results || [];
    if (!results.length) {
      logWarn("No results found.");
      return;
    }
    results.slice(0, 20).forEach((r, idx) => {
      const ts = new Date(r.ts || Date.now()).toISOString();
      console.log(
        `${idx + 1}) ${chalk.magenta(r.id)}  ${chalk.gray(ts)}  ${chalk.yellow(
          r.file
        )}`
      );
    });
  } catch (e: any) {
    logErr(e?.message || String(e));
  }
}

async function runShowRun(runIdOrFile: string) {
  printHeader();
  console.log(chalk.bold("▶ Show Run Details\n"));

  try {
    const file = runIdOrFile.endsWith(".json")
      ? runIdOrFile
      : `${runIdOrFile}.json`;

    const resp = await axios.get(`${API_BASE}/results/${file}`);
    const data = resp.data;
    if (!data.ok) {
      logErr(data.error || "Failed to fetch run");
      return;
    }

    console.log(chalk.green("Run:"));
    console.log(JSON.stringify(data.data, null, 2));
  } catch (e: any) {
    logErr(e?.message || String(e));
  }
}

async function runDemo() {
  const demoRepo = path.resolve(__dirname, "../../samples/demo-error");
  await runQuickSnap({
    repoPath: demoRepo,
    commandOverride: "node index.js",
    fix: true,
    verify: true,
  });
}

function runConfig() {
  printHeader();
  console.log(chalk.bold("▶ Config & Integrations\n"));
  console.log(
    "Backend URL  :",
    chalk.magenta(API_BASE.replace(/\/api\/v1$/, ""))
  );
  console.log();
  console.log("Integrations:");
  console.log(
    "  Cline   :",
    process.env.CLINE_CLI_PATH || process.env.CLINE_MCP_BASE_URL
      ? chalk.green("configured-ish (check logs)")
      : chalk.gray("not configured")
  );
  console.log(
    "  Kestra  :",
    process.env.KESTRA_API_URL && process.env.KESTRA_API_KEY
      ? chalk.green("configured")
      : chalk.gray("not configured")
  );
  console.log();
}

// ---------- Interactive menu (BASIC ONLY) ----------

async function showFancyMenu() {
  // Not used anymore; kept only so TypeScript doesn't complain.
  // We always use showBasicMenu() now.
  return "exit";
}

async function showBasicMenu() {
  printHeader();

  console.log("Select a mode:");
  console.log("  1) Quick Snap — auto-detect command, analyze & fix once");
  console.log("  2) Guard Mode — watch repo and auto-fix on failures");
  console.log("  3) Analyze Logs from file");
  console.log("  4) View Past Runs");
  console.log("  5) Show Run Details");
  console.log("  6) Demo: Fix the sample project");
  console.log("  7) Config & Integrations");
  console.log("  0) Exit");
  console.log();

  const { choice } = await inquirer.prompt([
    {
      type: "input",
      name: "choice",
      message: "Enter choice number:",
      validate: (v: string) =>
        ["0", "1", "2", "3", "4", "5", "6", "7"].includes(v.trim())
          ? true
          : "Please enter a number between 0 and 7",
    },
  ]);

  switch (String(choice).trim()) {
    case "1":
      return "snap";
    case "2":
      return "guard";
    case "3":
      return "analyze";
    case "4":
      return "results";
    case "5":
      return "show";
    case "6":
      return "demo";
    case "7":
      return "config";
    case "0":
    default:
      return "exit";
  }
}

async function showMainMenu() {
  let mode: string;

  // We ignore supportsFancyPrompts() for now and ALWAYS use basic menu
  mode = await showBasicMenu();

  switch (mode) {
    case "snap":
      await runQuickSnap({ fix: true, verify: true });
      break;
    case "guard":
      await runGuardMode({});
      break;
    case "analyze": {
      const { file } = await inquirer.prompt([
        { type: "input", name: "file", message: "Path to log file:" },
      ]);
      if (file) await runAnalyzeFromFile(file);
      break;
    }
    case "results":
      await runListResults();
      break;
    case "show": {
      const { runId } = await inquirer.prompt([
        { type: "input", name: "runId", message: "Run ID or filename (.json):" },
      ]);
      if (runId) await runShowRun(runId);
      break;
    }
    case "demo":
      await runDemo();
      break;
    case "config":
      runConfig();
      break;
    case "exit":
    default:
      console.log("Bye 👋");
      process.exit(0);
  }
}

// ---------- Commander CLI setup ----------

const program = new Command();

program
  .name("infinitysnap")
  .description("InfinitySnap CLI — AI-assisted sandbox · auto-fix · verify")
  .version("0.2.0");

program
  .command("snap")
  .description("Run InfinitySnap once on this repo")
  .option("--fix", "Generate + apply patch + verify", false)
  .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
  .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
  .option("--no-verify", "Skip verify step after patch")
  .action(async (opts) => {
    await runQuickSnap({
      repoPath: opts.path,
      commandOverride: opts.command,
      fix: !!opts.fix,
      verify: opts.verify !== false,
    });
  });

program
  .command("guard")
  .description("Guard mode — periodically run command and auto-fix on failure")
  .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
  .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
  .option(
    "-i, --interval <sec>",
    "Interval in seconds (default 60)",
    (v) => parseInt(v, 10)
  )
  .action(async (opts) => {
    await runGuardMode({
      repoPath: opts.path,
      commandOverride: opts.command,
      intervalSec: opts.interval,
    });
  });

program
  .command("analyze")
  .description("Send a log file to InfinitySnap backend for analysis")
  .option("-f, --file <path>", "log file path")
  .action(async (opts) => {
    if (!opts.file) {
      logErr("Provide --file <path>");
      return;
    }
    await runAnalyzeFromFile(opts.file);
  });

program
  .command("results")
  .description("List past InfinitySnap runs")
  .action(async () => {
    await runListResults();
  });

program
  .command("show")
  .description("Show detailed information about a given run")
  .argument("<runIdOrFile>", "Run ID or filename (.json)")
  .action(async (runIdOrFile) => {
    await runShowRun(runIdOrFile);
  });

program
  .command("demo")
  .description("Run the built-in InfinitySnap demo on the sample project")
  .action(async () => {
    await runDemo();
  });

program
  .command("config")
  .description("Show backend & integrations status")
  .action(() => {
    runConfig();
  });

// If no subcommand → show interactive menu
const hasSubcommand = process.argv.slice(2).length > 0;

if (!hasSubcommand) {
  showMainMenu().catch((e) => {
    logErr(e?.message || String(e));
    process.exit(1);
  });
} else {
  program.parse(process.argv);
}

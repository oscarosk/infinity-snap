#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import inquirer from "inquirer";
import { spawnSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

import pkg from "../package.json";

import { runStart } from "./commands/start";
import { runFix } from "./commands/fix";
import { runList } from "./commands/list";
import { runView } from "./commands/view";
import { runWatch } from "./commands/watch";
import { runOpen } from "./commands/open";
import { runDoctor } from "./commands/doctor";
import { printHeader, err, info, warn } from "./ui/render";

const argv = process.argv.slice(2);

// ---------------------------------------------------------
// Normalize backend API key env for all CLI modules
// ---------------------------------------------------------
// Backend returns 401 UNAUTHORIZED when BACKEND_API_KEY is set server-side.
// CLI should send x-api-key. We standardize on INFINITYSNAP_BACKEND_API_KEY.
//
// Supported:
// - INFINITYSNAP_BACKEND_API_KEY (preferred)
// - BACKEND_API_KEY (fallback)
(function normalizeBackendKeyEnv() {
  const key =
    (process.env.INFINITYSNAP_BACKEND_API_KEY || "").trim() ||
    (process.env.BACKEND_API_KEY || "").trim();

  if (key) process.env.INFINITYSNAP_BACKEND_API_KEY = key;
})();

// ---------------------------------------------------------
// Fast-path: `infinitysnap review ...` (pre-commit/CI)
// ---------------------------------------------------------
if (argv[0] === "review") {
  const child = spawnSync(
    process.execPath,
    [require.resolve("./review"), ...argv.slice(1)],
    { stdio: "inherit" }
  );
  process.exit(child.status ?? 1);
}

function resolveRepoPath(p?: string): string {
  const v = (p ?? "").trim();
  return v ? path.resolve(v) : process.cwd();
}

function dieUsage(program: Command): never {
  printHeader();
  program.outputHelp();
  process.exit(2);
}

type HomeAction = "quick" | "fix" | "analyze" | "runs" | "doctor" | "exit";

const HOME_CHOICES: Array<{ label: string; value: HomeAction }> = [
  { label: "Quick Snap — one-shot autonomous fix (analyze → patch → verify)", value: "quick" },
  { label: "Fix — full fix pipeline (same as: infinitysnap fix)", value: "fix" },
  { label: "Analyze Only — diagnose failures (no code changes)", value: "analyze" },
  { label: "Runs — list & inspect history", value: "runs" },
  { label: "Doctor — connectivity / env checks", value: "doctor" },
  { label: "Exit", value: "exit" },
];

function canRenderArrowMenu(): boolean {
  const term = (process.env.TERM || "").toLowerCase();
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  if (term === "dumb") return false;
  if (process.env.CI === "true") return false;
  if (process.env.INFINITYSNAP_SIMPLE_MENU === "1") return false;
  return true;
}

function printHomeMenuNumbered(): void {
  printHeader();
  console.log("Select an option:\n");
  HOME_CHOICES.forEach((c, i) => {
    console.log(`  ${i + 1}) ${c.label}`);
  });
  console.log("");
}

function readLine(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer ?? "").trim());
    });
  });
}

async function promptNumberedChoice(): Promise<HomeAction> {
  printHomeMenuNumbered();

  while (true) {
    const raw = await readLine(`? Enter choice [1-${HOME_CHOICES.length}] (default 1): `);
    const pick = raw === "" ? 1 : Number(raw);

    if (Number.isInteger(pick) && pick >= 1 && pick <= HOME_CHOICES.length) {
      return HOME_CHOICES[pick - 1].value;
    }
    warn(`Please enter a number between 1 and ${HOME_CHOICES.length}.`);
  }
}

async function promptArrowChoice(): Promise<HomeAction> {
  const { value } = await inquirer.prompt<{ value: HomeAction }>([
    {
      type: "list",
      name: "value",
      message: "What do you want to do?",
      pageSize: 10,
      loop: false,
      choices: HOME_CHOICES.map((c) => ({ name: c.label, value: c.value })),
      default: "quick",
    },
  ]);
  return value;
}

async function promptHomeAction(opts?: { forceArrow?: boolean }): Promise<HomeAction> {
  const forceArrow = !!opts?.forceArrow;

  if (forceArrow) return promptArrowChoice();

  if (canRenderArrowMenu()) {
    try {
      return await promptArrowChoice();
    } catch {
      info("Interactive menu unavailable; falling back to stable numbered menu.");
    }
  }

  return promptNumberedChoice();
}

async function promptRepoAndCommand(): Promise<{ repoPath: string; command?: string; verify: boolean }> {
  const { repoPathRaw } = await inquirer.prompt<{ repoPathRaw: string }>([
    {
      type: "input",
      name: "repoPathRaw",
      message: "Repo path (press Enter for current directory):",
      default: process.cwd(),
      filter: (v: string) => resolveRepoPath(v),
      validate: (v: string) => (v.trim().length > 0 ? true : "Please enter a path."),
    },
  ]);

  const { commandRaw } = await inquirer.prompt<{ commandRaw: string }>([
    {
      type: "input",
      name: "commandRaw",
      message: 'Command to run (example: "npm test") — leave blank to auto-detect:',
      default: "",
      filter: (v: string) => String(v ?? "").trim(),
    },
  ]);

  const { verify } = await inquirer.prompt<{ verify: boolean }>([
    {
      type: "confirm",
      name: "verify",
      message: "Run verification step?",
      default: true,
    },
  ]);

  return {
    repoPath: repoPathRaw,
    command: commandRaw || undefined,
    verify,
  };
}

// ---------------------------------------------------------
// Interactive home (runs when user types `infinitysnap`)
// ---------------------------------------------------------
async function interactiveHome(opts?: { forceArrow?: boolean }): Promise<void> {
  const action = await promptHomeAction({ forceArrow: !!opts?.forceArrow });

  if (action === "exit") process.exit(0);
  if (action === "runs") {
    await runList();
    return;
  }
  if (action === "doctor") {
    await runDoctor();
    return;
  }

  const { repoPath, command, verify } = await promptRepoAndCommand();
  console.log("");

  if (action === "quick") {
    await runStart({ repoPath, command, fix: true, verify });
    return;
  }
  if (action === "fix") {
    await runFix({ repoPath, command, verify });
    return;
  }

  await runStart({ repoPath, command, fix: false, verify: false });
}

// ---------------------------------------------------------
// Commander program
// ---------------------------------------------------------
const program = new Command();

program
  .name("infinitysnap")
  .description("InfinitySnap CLI — Autonomous Fix · Sandbox · Verify")
  .version(pkg.version);

// Forces arrow-key UI even in finicky terminals
program
  .command("ui")
  .description("Interactive UI (arrow menu). Use for local dev; may not work in all terminals.")
  .action(async () => {
    await interactiveHome({ forceArrow: true });
  });

// Always-stable simple menu (judge mode)
program
  .command("menu")
  .description("Stable menu (numbered). Recommended for demos/judges.")
  .action(async () => {
    process.env.INFINITYSNAP_SIMPLE_MENU = "1";
    await interactiveHome({ forceArrow: false });
  });

// Aliases
program
  .command("quick")
  .description('One-shot autonomous fix. Example: infinitysnap quick . --command "npm test"')
  .option("--no-verify", "Skip verify step")
  .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
  .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
  .action(async (opts: { path?: string; command?: string; verify?: boolean }) => {
    await runStart({
      repoPath: resolveRepoPath(opts.path),
      command: opts.command,
      fix: true,
      verify: opts.verify !== false,
    });
  });

program
  .command("analyze")
  .description("Analyze only (no code changes).")
  .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
  .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
  .action(async (opts: { path?: string; command?: string }) => {
    await runStart({
      repoPath: resolveRepoPath(opts.path),
      command: opts.command,
      fix: false,
      verify: false,
    });
  });

program
  .command("runs")
  .description("Alias for list")
  .action(async () => {
    await runList();
  });

// Original commands
program
  .command("snap")
  .description("Run once (snap + analyze). Use --fix to generate/apply/verify.")
  .option("--fix", "Run the full fix pipeline", false)
  .option("--no-verify", "Skip verify step")
  .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
  .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
  .action(async (opts: { fix?: boolean; path?: string; command?: string; verify?: boolean }) => {
    await runStart({
      repoPath: resolveRepoPath(opts.path),
      command: opts.command,
      fix: !!opts.fix,
      verify: opts.verify !== false,
    });
  });

program
  .command("fix")
  .description('One-command fix pipeline. Example: infinitysnap fix . --command "npm test"')
  .option("--no-verify", "Skip verify step")
  .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
  .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
  .action(async (opts: { path?: string; command?: string; verify?: boolean }) => {
    // Helpful hint: if backend is locked and CLI key missing, /fix will 401 and you will fall back to Cline.
    const key = (process.env.INFINITYSNAP_BACKEND_API_KEY || "").trim();
    if (!key) {
      warn(
        "Backend may be protected (BACKEND_API_KEY). If you see UNAUTHORIZED or Cline fallback, set INFINITYSNAP_BACKEND_API_KEY (or BACKEND_API_KEY) in your CLI env/.env."
      );
    }

    await runFix({
      repoPath: resolveRepoPath(opts.path),
      command: opts.command,
      verify: opts.verify !== false,
    });
  });

program
  .command("list")
  .description("List past InfinitySnap runs")
  .action(async () => {
    await runList();
  });

program
  .command("view")
  .description("Show detailed information about a given run")
  .argument("<runIdOrFile>", "Run ID or filename (.json)")
  .action(async (runIdOrFile: string) => {
    await runView(runIdOrFile);
  });

program
  .command("watch")
  .description("Watch a run live (polling results for now)")
  .argument("<runId>", "Run ID")
  .option("-i, --interval <sec>", "Polling interval (default 1s)", (v: string) => parseInt(v, 10), 1)
  .action(async (runId: string, opts: { interval: number }) => {
    await runWatch(runId, opts.interval);
  });

program
  .command("open")
  .description("Open dashboard run page in browser")
  .argument("<runId>", "Run ID")
  .action(async (runId: string) => {
    await runOpen(runId);
  });

program
  .command("doctor")
  .description("Check backend/Kestra connectivity and env configuration")
  .action(async () => {
    await runDoctor();
  });

program.showHelpAfterError(true);
program.configureHelp({ sortSubcommands: true });

// ---------------------------------------------------------
// Entry behavior
// ---------------------------------------------------------
async function main(): Promise<void> {
  if (argv.length === 0) {
    await interactiveHome();
    return;
  }

  if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    dieUsage(program);
  }

  await program.parseAsync(process.argv);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  err(msg);
  process.exit(1);
});
